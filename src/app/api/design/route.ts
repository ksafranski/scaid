import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { client, friendlyApiError, logUsage } from "@/lib/anthropic";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { normalizeText } from "@/lib/emoji";
import { encodeEvent, type AgentEvent } from "@/lib/agentEvents";
import { StreamedFields } from "@/lib/partialJson";
import { findAdvice, findProblems } from "@/lib/scadLint";
import { ActionField, IconField, reportIconDrift } from "@/lib/designSchema";
import { PATTERN_INDEX, patternBrief } from "@/lib/scadPatterns/prompt";
import { describeMeasurements } from "@/lib/geometry/facts";
import { MeasuredSchema } from "@/lib/geometry/measuredSchema";
import { MAX_PLATE_MM, MIN_PLATE_MM } from "@/lib/types";

// 300s is the platform maximum on Hobby and the default everywhere. Real requests land
// at 30-50s; the headroom is for a complex model, not an expectation.
export const maxDuration = 300;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

/**
 * The repair pass runs on a smaller model than the design pass.
 *
 * Designing is open-ended: it decides what the object is, picks the shapes, and writes the
 * explanation someone learns from. Repair is the opposite — a named fault in a program that
 * already exists, with the compiler's own message attached and an instruction to change
 * nothing else. It is the one job here that comes with ground truth, and the narrowest, so
 * it does not need the biggest model and the saving is several-fold on every failed build.
 *
 * Set ANTHROPIC_REPAIR_MODEL to put it back on the design model if a repair ever comes back
 * worse than the failure it was fixing.
 */
const REPAIR_MODEL = process.env.ANTHROPIC_REPAIR_MODEL || "claude-sonnet-5";

/**
 * How long the design pass deliberates before it writes.
 *
 * Thinking is billed as output and output is most of the bill, so this is the largest single
 * cost and latency knob in the app — and the least verifiable, because the only test of a
 * build is whether the object is right.
 *
 * Low, measured against medium on the same two prompts: a first build 49s to 30s, and a
 * small change 146s to 117s with a quarter off the tokens, both coming out correct. The
 * evidence is two builds, which is why it is a setting rather than a constant: a threaded
 * box or a gear train may want more room to think than a box with rounded edges, and this
 * is the dial to turn if one comes back worse.
 */
const EFFORT = (process.env.ANTHROPIC_DESIGN_EFFORT || "low") as "low" | "medium" | "high";

/** A one-tap reply: what the button says, and what gets sent when it's pressed. */
const ChoiceSchema = z.object({
  label: z
    .string()
    .describe("Two to five words, for a button. The choice itself, no trailing punctuation."),
  prompt: z
    .string()
    .describe(
      "What gets sent as their next message if they pick this — a full, specific instruction " +
        "written in their voice, e.g. 'Give it a chunky handle I can get four fingers through.'",
    ),
});

/**
 * Field order is load-bearing.
 *
 * Structured output is generated in schema order, so this is also the order the browser
 * learns things in. Putting the approach and the parts ahead of the code means the studio
 * can report what's being built while it's still being built, from the model's own words
 * rather than from a timer. `action` leads because everything after it depends on which
 * kind of turn this is.
 */
const DesignSchema = z.object({
  action: ActionField
    .describe(
      "'build' unless you genuinely cannot start without an answer. Default to building.",
    ),
  question: z
    .string()
    .describe(
      "The one thing you need to know, when action is 'ask'. A single plain question about " +
        "what the object is for or how it should feel — never about millimeters. Empty string " +
        "when action is 'build'.",
    ),
  options: z
    .array(ChoiceSchema)
    .max(4)
    .describe(
      "Two to four answers to that question, when action is 'ask'. Each has to lead somewhere " +
        "visibly different. Empty when action is 'build'.",
    ),
  plan: z
    .string()
    .describe(
      "One sentence, present tense, on how you're going to build this — the shapes you'll " +
        "start from. Written BEFORE you work out the details, so keep it to the approach. " +
        "e.g. 'Starting with a tapered tube for the body, then four swept fins around the base.'",
    ),
  requirements: z
    .array(
      z.object({
        text: z
          .string()
          .describe("One thing they asked for, in their words, as short as you can make it."),
        done: z
          .boolean()
          .describe("Whether the model AS IT NOW STANDS satisfies this. Not whether you intend to."),
      }),
    )
    .max(12)
    .describe(
      "Everything they asked for, listed before you write a line of code, so nothing gets " +
        "quietly dropped. Start one only when a request carries several distinct requirements " +
        "— a checklist of one is noise. But once a checklist exists you are given it back every " +
        "turn, and every line of it comes back with the status updated, however small this " +
        "turn's change was. The list belongs to the object, not to the message that began it.",
    ),
  name: z
    .string()
    .describe(
      "A short name for the object itself, 2-4 words, no punctuation at the end. Names the thing, " +
        "not the change — keep it the same across tweaks unless it genuinely becomes something else.",
    ),
  steps: z
    .array(
      z.object({
        icon: IconField
          .describe(
            "The icon that best matches this step. Pick by meaning: a solid shape name for a part " +
              "you made, an operation for how you combined parts, a movement for how you placed " +
              "them, or a craft icon for finishing.",
          ),
        title: z.string().describe("A few words naming the part, e.g. 'The nose cone'."),
        why: z
          .string()
          .describe(
            "One or two sentences on which shape you used and WHY. Specific, with real millimeter " +
              "sizes where they help. No jargon, no talking down. American English.",
          ),
      }),
    )
    .max(6)
    .describe(
      "The build, broken into the handful of parts someone would actually notice. Empty when " +
        "action is 'ask'.",
    ),
  description: z
    .string()
    .describe(
      "One sentence on what the finished object IS, for someone seeing it fresh who knows nothing " +
        "about this conversation. Never mentions changes, fixes, or earlier versions. Rewritten " +
        "every turn to match how the object stands now. American English.",
    ),
  summary: z
    .string()
    .describe(
      "Two or three sentences to the person on what you just did. First build: what you made. A " +
        "change: what changed and why. Concrete, brief, a little fun. American English.",
    ),
  checkpoint: z
    .object({
      look: z
        .string()
        .describe(
          "One sentence asking them to check something they can only judge by looking at the " +
            "model — a proportion, a stance, whether a gap reads right. Not a summary of the " +
            "build. Empty when action is 'ask'.",
        ),
      directions: z
        .array(ChoiceSchema)
        .max(3)
        .describe(
          "Exactly three honest next moves from here, most useful first. If you deliberately " +
            "left something for later, that's the first one. Empty when action is 'ask'. " +
            "Never offer stopping as a direction — the studio always provides that itself.",
        ),
    })
    .describe("Where the build pauses so they can look at it and choose what happens next."),
  code: z
    .string()
    .describe(
      "The complete OpenSCAD program. Nothing else — no markdown fences. Empty when action " +
        "is 'ask': don't write code you're about to throw away.",
    ),
});

const SYSTEM = `You are Scaid, a 3D design partner for people who are new to making things — think middle school and up.

You do three jobs, and they all matter:
1. Write correct OpenSCAD code that renders into the thing they asked for.
2. Explain what you built and WHY, so they learn something and can take the next step themselves.
3. Work the way a designer works — a rough version, a look, a decision, a better version — so they
   pick up the habit by doing it with you.

## First decide: ask, or build?
Almost always **build**. A question you didn't need to ask is a worse experience than a sensible
choice you explained, and someone who typed "a coffee mug" wants a coffee mug, not a form to fill in.

Ask only when both of these are true:
- The answer changes the SHAPE, not a number. "How tall?" is never worth asking — pick a size and
  say why. "Is this holding a phone or a book?" is, because those are different objects.
- You genuinely can't pick a sensible default and explain it.

"a chess pawn", "a plant pot", "a mug" — build them, all of them.
"a holder", "a bracket", "a stand", "a case for my thing" — ask, because you'd be guessing at what
the object even is.

**This applies just as much to changes.** A request to add something usually doesn't say where it
goes, and where it goes is the whole decision. "Add a screw hole" — down through the thick end,
sideways through the back, countersunk flush, two of them? Those are different objects and there is
no default worth defending, so ask. Adding a handle, a lid, a hole, a mount, a slot, a hook: ask
where and what kind, once.

What still doesn't need a question: anything you can pick well and explain. "Make it taller",
"round the edges", "thicker walls", "make it wider" — choose a number, say why, build it.

When you ask: exactly one question, two to four options, each leading somewhere visibly different.
Never two questions. Never a question you could answer yourself by choosing well. On an ask turn
write no code, no steps, no plan — just the question and the options.

Make the options concrete enough to picture: "Straight down through the thick end" beats "Vertical".
Say where and how, not which axis. And never write an option that means "something else" — the studio
adds that itself.

## When they hand you a lot at once
A long request with a lot of specifics is the easiest kind to get wrong. Writing one big program
against a wall of detail is how requirements get half-done or silently skipped.

So enumerate before you build. Every distinct thing they asked for goes in **requirements**, one
short line each, in their words — and you write that list before you write any code, so you're
building against something explicit rather than against a memory of the paragraph.

Then be honest in the checkboxes. "Done" means the model as it stands right now satisfies that
line. Not that you meant to, not that it's nearly there. When a requirement is about a size and
you were given measurements, tick it against the measurement, not against what you meant to build. A requirement marked done that isn't is
worse than no list at all, because they'll stop checking.

Once a checklist exists it is handed back to you on every later turn. Re-list all of it, every
time, with each line's status updated — even when this turn's message was one small change and the
list is mostly untouched. Dropping it silently is how a promise gets forgotten, and they are
watching that list to know what's left.

Four or more requirements is too many for one pass. Satisfy the ones that establish the shape, mark
the rest not done, and say in the summary which you're leaving and why that order makes sense. Every
turn after that re-lists all of them with the statuses updated, so the list fills in as you go and
they can see exactly what's left.

## Build in stages when there's enough there to stage
Someone learning this should see that a model gets good by being changed, not by being conjured
whole. When a request has real separable parts, build the part everything else hangs off — one solid,
finished-looking object that renders on its own — then stop. Say plainly in the summary what you left
for the next round and why that order makes sense.

Do NOT stage something simple. A keychain, a coaster, a die, a pawn is one build. Staging a small
object is busywork and they'll feel it.

Never leave a stage broken or half-modeled. Every stage is a complete object; it just isn't the
finished one yet.

## Every build ends at a checkpoint
The checkpoint is the point of all this — it's where they look at what exists and decide, instead of
accepting whatever arrives.
- **look** asks them to judge one thing they can only see by spinning it: does the base look wide
  enough to trust, does the handle sit too low, is the wall thick enough to hold. Never a recap.
- When requirements are still unticked, the first direction is the most important one of them.
- **directions** are exactly three real next moves, most useful first, each one a genuinely different
  outcome. If you deliberately left a stage for later, that's the first direction. Include at least
  one that changes what's already there rather than adding to it — going back and fixing something
  is the part people skip.

Never write "leave it as is", "looks finished" or anything else that amounts to stopping. The studio
puts its own way out next to your three, so spending one of them on that wastes it.

Directions are suggestions, never a menu they're stuck inside. They can always just say something.

A build turn without a checkpoint is an unfinished turn. However long the program was, however
obvious the next move seems, you still write **look** and three **directions** — that pause
is the whole point of working this way, and skipping it hands them a finished object and nothing to
decide.

## Four different pieces of writing
These are not interchangeable, and mixing them up is the most common mistake here:
- **plan** is the first thing you write and the person watches it appear while you work. Present
  tense, one sentence, the approach only: which basic solids you're starting from. Not a summary of
  finished work — you haven't done it yet.
- **name** and **description** describe the OBJECT. They have to stand alone, because they're what
  someone sees in their library weeks later with no memory of this conversation. A mug is "a mug with
  a chunky handle" whether it's the first version or the ninth. Never write them as a report of what
  changed.
- **summary** is the message TO the person right now. On a change, it says what you changed and why.
  Changes belong here and nowhere else.

## How you write
- **American English. Always.** color, meter, millimeter, center, gray, modeling, favorite.
- **Be brief.** Every sentence earns its place. Say the thing, give the reason, stop. If you can cut a
  word, cut it.
- **Be specific.** Real numbers beat adjectives. "The base is 8mm wider than the top" beats "a nice
  wide base."
- **Have some fun with it.** A little personality is good — you're describing something they're about
  to hold. Dry and clinical is boring. So is trying too hard.
- Always give the reason behind a choice: "the base is wider so it won't tip" beats "the base is 40mm."
- Assume they're smart but new to this. Explain the reasoning, not the vocabulary. If a shape word
  earns its place, use it plainly: "a cylinder — a tube, like a can."
- Never mention OpenSCAD syntax, modules, booleans, or programming words in the summary or steps. Talk
  about SHAPES and REASONS.
- No exclamation-mark pileups, no "great question," no talking down.
- Say what you simplified or skipped, and what you'd try next.

## Rules for the code
- Use ONLY built-in OpenSCAD features. No include<>, no use<>, no external libraries — they are not
  installed and will fail. This holds even when a worked technique is handed to you below: paste
  what you need into the program so it stands on its own. Someone downloads this file and opens it
  in their own OpenSCAD, where nothing is installed beside it.
- **No text().** This build ships no fonts, so any lettering fails with "Can't get font" and there is
  nothing they can do about it. Never write it, and never offer letters, names or numbers as a
  direction — carve a recognizable shape instead.
- Sizes are millimeters. Keep the whole model roughly 20-150mm so it fits nicely on screen.
- Build the model sitting on the ground plane (z = 0) and centered around x = 0, y = 0.
- Set $fn between 32 and 64 near the top. Higher is slower and the preview will crawl.
- **$fn is paid once per shape, so a form built from many copies pays it every time.** When you
  repeat or hull a sphere or cylinder more than about twenty times — a sweep along a path, a coil,
  a spiral, a row of ribs or grooves — give that primitive its own low $fn inside the call
  ($fn = 12 to 24 is plenty), instead of letting it inherit the one at the top. How smooth a swept
  shape looks comes from how many steps you take ALONG the path, not from how round each step is,
  so this changes nothing anyone can see. It is the difference between a model that appears in
  three seconds and the same model taking twenty-five, which is the most common reason a build
  feels broken.
- The result must be one solid, watertight shape suitable for 3D printing. Avoid zero-thickness walls
  and faces that exactly touch — overlap parts slightly (0.01mm) so they truly fuse.
- Use color() when it helps them read the separate parts. It shows up in the preview.
- **Keep colors mid-tone or darker.** White, pale grey and any washed-out tint lose their own
  shading on screen: every face comes back at about the same brightness, the edges between them
  stop showing, and the object flattens into a silhouette. A mid or deep tone holds the shading
  and the form stays readable. So reach for a slate grey over a white, a deep teal over a pale
  one. If they ask for white, build it white — that is their call, not yours to quietly change.
- Add a short comment above each part, in the same plain language as your steps, so the code reads
  like your explanation.
- Prefer simple, readable code over clever code. Someone is going to read this and learn from it.
- Write the code in the order your steps describe, so the two read together.

## Put the sizes that matter at the top, as dials
The studio turns named numbers at the top of a program into sliders the person can move, and
moving one rebuilds the model. That is the difference between an object they were handed and an
object they own, so it is worth real care.

Start every program with its adjustable dimensions, each on its own line, each with a range:

    /* [Size] */
    height = 80;        // How tall it stands [40:200]
    diameter = 72;      // Across the middle [30:150]

    /* [Details] */
    wall = 2.5;         // Wall thickness [1:0.2:5]
    has_lid = true;     // Put a lid on it

Then write the body in terms of those names — never repeat a number underneath that one of them
already stands for, or the dial will move half the model and leave the rest behind. If the wall is
\`wall\`, the inner radius is \`diameter / 2 - wall\`, not \`33.5\`.

- \`[low:high]\`, or \`[low:step:high]\` when whole millimeters are too coarse. Always give a range:
  without one they get a box to type in instead of something to drag.
- Pick ranges that stay printable and stay recognizable at both ends. The point of the low end
  is that someone can go there and see what happens, so it has to still build.
- \`true\`/\`false\` becomes a switch. A list like \`// [round, square]\` becomes a menu.
- **Four to eight dials.** Every number in the program is not a dial — choose the ones someone
  would actually want to change, and leave the rest as ordinary arithmetic in the body.
- Group them with \`/* [Heading] */\` when there are more than about four.
- The comment before the range is the label they read, so write it as words: \`// How tall it
  stands\`, not \`// h\`.
- Anything below the first module or the first shape is out of reach, so the dials have to be at
  the very top, above everything else.

When you change a build, keep the dials that are still meaningful and keep their names, so a
person who had set one doesn't lose it.

The dials are not one of your build steps. Steps describe the shapes the object is made of, and
a list of numbers isn't a shape — mention in the summary that the sizes are adjustable if it's
worth saying, and leave the steps for the object itself.

## When they ask for a change
You get the code you wrote last time. Change only what they asked about and keep everything else
exactly as it was, so their build stays recognizable. Put what you changed in the summary — and
rewrite the description to fit the object as it now stands, still with no mention of the change.

## When they mark up the model
Sometimes the picture is the model you already built with marks drawn on it — loops around a part,
arrows pointing at one. That is not something to build. It's them pointing at your own work.

Work out which piece of your code sits under each mark and change those, leaving everything else
exactly as it was. Name the parts you settled on in your summary ("the handle", "the rim near the
spout") so a wrong guess is obvious immediately and costs one message instead of a whole round.

What they typed alongside says what to do about the marked parts. If a mark genuinely covers
several parts, say so and change the one the words point at.

## When they attach a picture
The picture is what they want to make. Look at its overall shape and build a simplified 3D version out
of basic solids. Don't chase fine detail or texture; clean and chunky prints better and reads better.
Say what you spotted and what you simplified, so they know you looked.

## When they attach a document
A PDF or a written note is a brief, not a thing to copy out. Someone attaching a datasheet wants the
object to fit the part it describes; someone attaching their own notes wants what they wrote built.

- Pull out what the object has to be and put it in **requirements**, in their words. A document is
  exactly the case that list exists for: a page of detail is the easiest thing to half-do.
- **Sizes in a document are measurements of a real thing, so treat them as fixed.** If it says the
  board is 85 x 56mm, the holder is built around 85 x 56mm and the clearance goes outside that.
  Never round one to something tidier, and say which numbers you took from the document.
- A drawing or photo inside a PDF is a picture — read it the same way you'd read an attached one.
- If it says nothing about what to make, say so and ask, rather than inventing a use for it.
- Say what you used and what you ignored. A long document always has more in it than matters, and
  they can't tell which parts you read unless you tell them.

## What the last build actually measured
Sometimes you are given measurements below. They were taken off the mesh the renderer produced,
not estimated, so they are true — and they describe THE LAST BUILD THAT RENDERED, which after a
failed edit is not the same as the code in front of you.

- Never contradict them, and never state a measurement you weren't given. If you want a number
  that isn't there, say you'd have to build it and look.
- Don't recite the list back. One measurement that matters beats five that don't.
- **When a measurement contradicts what you said last turn, say so plainly.** "I said 60mm and it
  came out 62.4 — the rounded top added height" is the most useful sentence you can write here.
- Volume and weight assume a solid lump. A real print is mostly hollow, so never give a weight as
  fact — "about 10 grams if it were solid" is the honest way to say it.
- **Not closed is a real defect**, not a detail: the download comes out broken. Fix that before
  you add anything else, and say that's what you're doing.
- On a steep overhang, say roughly where it is and offer to change the SHAPE — a chamfer under
  it, a taper, standing the part a different way up. Don't tell them to turn on supports; the
  object is the thing they can change.
- If the balance point sits outside the footprint, or it touches the plate over almost nothing,
  raise it without being asked. It'll fall over or come off the plate, and they'll find out the
  slow way.
- Say all of this in shapes. Never "mesh", "manifold", "normals", "watertight", "non-manifold".
  "It's got a hole in it" and "it's closed all the way round" are the words.

${PATTERN_INDEX}`;

/**
 * The repair pass.
 *
 * This runs with something the design pass never has: ground truth. Either OpenSCAD itself
 * refused to compile the code, or a check found a certain failure. So the job here is
 * narrow — fix the named fault and change nothing else.
 */
const RepairSchema = z.object({
  note: z
    .string()
    .describe(
      "One short sentence to the person on what was wrong and what you did about it, in plain " +
        "language. No error codes, no OpenSCAD jargon. American English. e.g. 'Two walls were " +
        "touching without overlapping, so I merged them properly.'",
    ),
  code: z.string().describe("The complete corrected OpenSCAD program. Nothing else — no fences."),
});

const REPAIR_SYSTEM = `You fix OpenSCAD code that failed to build. You are given the program, the exact
failure, and what the model is supposed to be.

Rules:
- Fix the reported fault and NOTHING else. Every unrelated line comes back byte-identical. The person
  is watching their model on screen and it must still be recognizably theirs.
- Return the complete program, not a patch or a fragment.
- Use ONLY built-in OpenSCAD features. No include<>, no use<> — no libraries are installed.
- Keep it watertight and printable: overlap touching parts by 0.01mm, no zero-thickness walls.
- Keep the existing comments and formatting.
- If the failure is a syntax error, read the reported line number carefully — the real mistake is
  often on the line above it.
- The note is for a beginner. Say what was wrong in shape terms, not compiler terms.`;

/**
 * Hard ceiling on an attachment's payload.
 *
 * Vercel caps a function's whole request body at 4.5MB and rejects anything larger with a
 * 413 before this handler runs — so a limit sized to Anthropic's 5MB-per-image allowance
 * would be unreachable. 3MB here leaves ~1.3MB for the prompt, the current code and the
 * conversation history. The browser aims far below this for every kind of attachment; this
 * is a backstop for direct callers.
 */
const MAX_ATTACHMENT_BASE64 = 3 * 1024 * 1024;

const RequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  currentCode: z.string().max(60000).optional(),
  attachment: z
    .discriminatedUnion("form", [
      z.object({
        form: z.literal("image"),
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
        data: z.string().max(MAX_ATTACHMENT_BASE64, "That picture is too large to send. Try a smaller one."),
        /** A photo of what to make, or the current model with a part circled on it. */
        /**
         * What the picture is for, which decides how it should be read.
         *
         * 'reference' is a thing to make. 'region' is the model with part of it circled.
         * 'current' is the model as it stands, sent automatically alongside a follow-up so
         * the words "the handle" have something to point at — nobody chose to attach it and
         * it is never the thing to build.
         */
        kind: z.enum(["reference", "region", "current"]).default("reference"),
        name: z.string().max(200).optional(),
      }),
      z.object({
        form: z.literal("document"),
        /** Base64 for a PDF; the words themselves for anything written. */
        mediaType: z.enum(["application/pdf", "text/plain"]),
        data: z.string().max(MAX_ATTACHMENT_BASE64, "That file is too large to send. Try a smaller one."),
        name: z.string().max(200).optional(),
      }),
    ])
    .optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(6000) }))
    .max(20)
    .optional(),
  /** The checklist as it stands, so a later turn can carry it forward instead of guessing. */
  requirements: z
    .array(z.object({ text: z.string().max(300), done: z.boolean() }))
    .max(12)
    .optional(),
  /**
   * What the last successful render actually measured.
   *
   * Every field is a bounded number or a boolean, and the sentences the model reads are
   * written from them on this side. No string the browser controls reaches the prompt
   * through here, so a field can't be used to say something the person didn't say.
   */
  measured: MeasuredSchema.optional(),
  /** The plate it has to fit on. Known even before anything has been built. */
  plateSizeMm: z.number().int().min(MIN_PLATE_MM).max(MAX_PLATE_MM).optional(),
  /**
   * Which worked techniques this build was made from, handed back from the last turn.
   *
   * Unknown ids are dropped rather than trusted, and the count is capped, so the worst a
   * caller can do with this is ask for patterns that were going to be free anyway.
   */
  patternIds: z.array(z.string().max(60)).max(12).optional(),
  /** Present when the browser's renderer rejected code we just produced. */
  repair: z
    .object({
      code: z.string().min(1).max(60000),
      error: z.string().min(1).max(4000),
      goal: z.string().max(600).optional(),
    })
    .optional(),
});

/**
 * The last finished sentence of a reasoning summary, or null if there isn't one yet.
 *
 * Only complete sentences go out. Reasoning streams a few words at a time, and a line that
 * rewrites itself mid-word as you read it is worse than no line at all.
 */
function lastCompleteThought(summary: string): string | null {
  const sentences = summary.match(/[^.!?\n]+[.!?]/g);
  if (!sentences) return null;

  const last = sentences[sentences.length - 1].trim();
  return last.length >= 15 ? last : null;
}

/** Models sometimes wrap code in markdown fences despite the schema description. */
function stripFences(code: string): string {
  return code.replace(/^\s*```(?:openscad|scad)?\n?/i, "").replace(/```\s*$/, "");
}


/**
 * Runs the repair model over a program with a known fault.
 *
 * `note` is first in the schema, so passing a `send` here means the person reads what was
 * actually wrong while the corrected code is still being written, rather than watching a
 * spinner for the whole pass.
 */
async function repairCode(args: {
  code: string;
  fault: string;
  goal?: string;
  /** What the build was made from, when the caller knows. */
  patternIds?: string[];
  send?: Send;
  signal: AbortSignal;
}) {
  // What the failing program was made of. Reading it off the code alone would miss anything
  // the agent renamed, which is most of it — so the remembered list is the real source and
  // the code is the fallback for a repair that arrives without one.
  const { text: patterns, ids } = patternBrief({
    prompt: "",
    currentCode: args.code,
    remembered: args.patternIds,
  });
  if (ids.length) console.log(`[repair] patterns: ${ids.join(", ")}`);

  const stream = client.messages.stream({
    model: REPAIR_MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: REPAIR_SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } },
      // The verified source for anything the broken program was built out of.
      //
      // Selection keys off the code alone, and a pattern only scores when the program
      // actually calls something it defines — so this is empty for most repairs and
      // exactly the right reference for the rest. Without it a failed thread or gear gets
      // repaired from memory, and comes back looking right and no longer fitting.
      ...(patterns ? [{ type: "text" as const, text: patterns }] : []),
    ],
    messages: [
      {
        role: "user",
        content:
          `What this is supposed to be: ${args.goal || "the model in the code below"}\n\n` +
          `What went wrong:\n${args.fault}\n\n` +
          `The program:\n${args.code}`,
      },
    ],
    // A repair is a named fault in code that already exists — the narrowest job here.
    output_config: { format: zodOutputFormat(RepairSchema), effort: "low" },
  }, { signal: args.signal });

  const send = args.send;
  if (send) {
    const fields = new StreamedFields();
    stream.on("text", (_delta, snapshot) => {
      const note = fields.note(snapshot);
      if (note) send({ t: "note", text: normalizeText(note) });

      const lines = fields.lines(snapshot);
      if (lines !== null) send({ t: "lines", count: lines });
    });
  }

  const response = await stream.finalMessage();
  logUsage("repair", response.usage);
  return response.parsed_output;
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "The design helper isn't switched on yet. Add ANTHROPIC_API_KEY to .env.local and restart the app.",
      },
      { status: 503 },
    );
  }

  const parsedBody = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Tell me what you'd like to make!" }, { status: 400 });
  }
  const body = parsedBody.data;

  const encoder = new TextEncoder();
  /** Cuts the model call short when there is no longer anyone to send it to. */
  const upstream = new AbortController();
  /**
   * Whether the response stream can still be written to.
   *
   * Set from two directions: our own completion, and the browser hanging up. The second one
   * is why it lives out here — a reload or a click on New during a 40-second build cancels
   * the response, and the model call carries on firing progress events at a controller that
   * is already gone.
   */
  let closed = false;

  // Once bytes are on the wire the status code is already 200, so from here on every failure
  // travels as an `error` event instead. Anything that can be rejected outright is above.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          // The reader went away between the check and the write. Nothing left to say, and
          // nothing worth logging: this is a browser closing a tab, not a fault.
          closed = true;
        }
      };

      try {
        const design = body.repair
          ? await runRepair(body, send, upstream.signal)
          : await runDesign(body, send, upstream.signal);
        if (design) send({ t: "design", design });
      } catch (error) {
        // A disconnect surfaces here as an abort. It isn't a failure, and there's no one to
        // tell about it either way.
        if (!closed) {
          console.error("[design] failed:", error);
          send({ t: "error", error: friendlyApiError(error) });
        }
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Raced with a cancel. The stream is gone, which is all close() wanted.
          }
        }
      }
    },

    cancel() {
      console.log("[design] client disconnected, stopping the model call");
      closed = true;
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // no-transform keeps proxies from buffering the whole body to compress it, which would
      // turn every progress event into one delivery at the very end.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

type Send = (event: AgentEvent) => void;
type Body = z.infer<typeof RequestSchema>;

/** The repair path: the browser's renderer rejected code we just produced. */
async function runRepair(body: Body, send: Send, signal: AbortSignal) {
  const repair = body.repair!;
  send({ t: "stage", stage: "fixing" });

  const fixed = await repairCode({
    code: repair.code,
    fault: `OpenSCAD reported:\n${repair.error}`,
    goal: repair.goal,
    patternIds: body.patternIds,
    send,
    signal,
  });
  if (!fixed) {
    send({ t: "error", error: "I couldn't work out that error. Try describing the fix you want." });
    return null;
  }

  return {
    name: "",
    description: "",
    summary: normalizeText(fixed.note),
    steps: [],
    code: stripFences(fixed.code),
  };
}

/** The main path: design something, then check what came out. */
async function runDesign(body: Body, send: Send, signal: AbortSignal) {
  const { prompt, currentCode, history, attachment } = body;

  let text = currentCode
    ? `Here is the code for what I have right now:\n\n${currentCode}\n\nPlease change it: ${prompt}`
    : prompt;

  // Measured, not estimated — and placed right after the code it was taken off, so the
  // program and what it actually produced read together.
  if (body.measured) {
    text += `\n\n${describeMeasurements(body.measured, body.plateSizeMm)}`;
  } else if (body.plateSizeMm) {
    text += `\n\nTheir build plate is ${body.plateSizeMm} mm square.`;
  }

  // Handed back verbatim so the list belongs to the object rather than to whichever message
  // happened to start it — the model has no other way to know what it already promised.
  if (body.requirements?.length) {
    const checklist = body.requirements
      .map((requirement) => `- [${requirement.done ? "x" : " "}] ${requirement.text}`)
      .join("\n");
    text += `\n\nThe checklist for this build so far:\n${checklist}\n\nCarry every one of these forward, with its status updated for the model as it stands after this change.`;
  }

  // A circled screenshot and a reference photo are opposite instructions — one is the thing
  // to make, the other is the thing already made. Left unsaid, a region capture reads as
  // "build me this picture of a lamp with a pink ring on it".
  // Nobody attached this one — the studio sends it with every follow-up. Left unsaid it
  // reads as a brief, and the next build comes back as a picture frame around a mug.
  if (attachment?.form === "image" && attachment.kind === "current") {
    text +=
      "\n\nThe picture is your own last build, as it looks on their screen right now. They " +
      "did not attach it and it is not a thing to make — it is there so that what they say " +
      "has something to point at, and so you can see what you actually produced rather than " +
      "what you meant to. Read their words as being about that object.\n\n" +
      "It is one camera angle, so parts of the object are behind other parts. Never say " +
      "something is missing or wrong because you cannot see it, and if what they are asking " +
      "about is hidden from this angle, work from the code instead and say so.";
  }

  if (attachment?.form === "image" && attachment.kind === "region") {
    text +=
      "\n\nThe picture is the model as it looks right now, marked up in pink. Loops enclose a " +
      "part and arrows point at one. Those marks are what this message is about — the rest of " +
      "the picture is only there so you can see where they sit. Work out which pieces of the " +
      "code they correspond to and change those, leaving the rest alone. Say which parts you " +
      "took them to mean, so I can tell you if you picked the wrong ones.";
  }

  // Whatever they attached goes before the text — Claude follows the instruction better in
  // that order, and it reads the way a person would hand something over before explaining it.
  const content: Anthropic.ContentBlockParam[] = [];
  if (attachment?.form === "image") {
    content.push({
      type: "image",
      source: { type: "base64", media_type: attachment.mediaType, data: attachment.data },
    });
  } else if (attachment?.form === "document") {
    content.push({
      type: "document",
      // A PDF travels as bytes because taking it apart here would lose the drawings that
      // are usually the reason for sending one. Anything written travels as itself.
      source:
        attachment.mediaType === "application/pdf"
          ? { type: "base64", media_type: "application/pdf", data: attachment.data }
          : { type: "text", media_type: "text/plain", data: attachment.data },
      ...(attachment.name ? { title: attachment.name } : {}),
    });
  }
  content.push({ type: "text", text });

  const messages: Anthropic.MessageParam[] = [
    ...(history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user" as const, content },
  ];

  const patterns = patternBrief({ prompt, currentCode, remembered: body.patternIds });
  if (patterns.ids.length) console.log(`[design] patterns: ${patterns.ids.join(", ")}`);

  send({ t: "stage", stage: "thinking" });

  const fields = new StreamedFields();
  let json = "";
  let stage: "thinking" | "parts" | "writing" = "thinking";

  const stream = client.messages.stream({
    model: MODEL,
    /**
     * Thinking is billed inside this, and it is spent before a single character of the
     * answer. At 16000 a long think could consume the whole budget and leave a response
     * with no text block at all — which is what "my answer came out muddled" was reporting.
     * Streaming means a high ceiling costs nothing in timeouts.
     */
    max_tokens: 64000,
    // Summarized rather than the default omitted: without it the reasoning streams as empty
    // blocks and the first minute looks like a hang. This is the only content that exists
    // before the plan, so it's what the studio shows while it waits.
    thinking: { type: "adaptive", display: "summarized" },
    // The system prompt is byte-identical on every request from every user, so caching it
    // means we pay full price for it once in a while instead of every time. Placed
    // explicitly rather than via top-level cache_control, which would land the breakpoint
    // on the (always different) user turn and never hit.
    //
    // An hour rather than the default five minutes. The write costs 2x instead of 1.25x,
    // which is worth it as soon as a second request arrives inside the window — and five
    // minutes is shorter than someone spends looking at a model and deciding what to
    // change, so the default was paying to re-cache the same bytes all day.
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } },
      // Chosen from this turn's request, so it must sit after the breakpoint above or the
      // cached prefix would change on every call and never hit.
      //
      // Given a breakpoint of its own, because the selection is now stable across the turns
      // of one build: it is remembered rather than re-derived, and a chosen set always
      // renders in library order. Measured at 3,701 tokens on a five-pattern build, which
      // was 28% of a low-thinking turn's bill and paid again every turn. It cost 1.25x once
      // and 0.1x after that.
      ...(patterns.text
        ? [
            {
              type: "text" as const,
              text: patterns.text,
              cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
            },
          ]
        : []),
    ],
    messages,
    // Effort is the supported way to trade thinking depth against time; budget_tokens is
    // rejected outright on this model.
    output_config: { format: zodOutputFormat(DesignSchema), effort: EFFORT },
  }, { signal });

  // Everything before the first character of the answer used to be silence. The reasoning
  // summary is the only thing that exists in that window, so it fills it.
  let lastThought = "";
  stream.on("thinking", (_delta, snapshot) => {
    const thought = lastCompleteThought(snapshot);
    if (thought && thought !== lastThought) {
      lastThought = thought;
      send({ t: "thought", text: normalizeText(thought) });
    }
  });

  // Structured output arrives as a text block holding JSON, generated in schema order, so
  // these deltas are the model's real progress through the build — not a timer pretending.
  stream.on("text", (_delta, snapshot) => {
    json = snapshot;

    const plan = fields.plan(json);
    if (plan) {
      stage = "parts";
      send({ t: "stage", stage: "parts" });
      send({ t: "plan", plan: normalizeText(plan) });
    }

    const name = fields.name(json);
    if (name) send({ t: "name", name: normalizeText(name) });

    for (const part of fields.parts(json)) {
      send({ t: "part", index: part.index, icon: part.icon, title: normalizeText(part.title) });
    }

    const lines = fields.lines(json);
    if (lines !== null) {
      if (stage !== "writing") {
        stage = "writing";
        send({ t: "stage", stage: "writing" });
      }
      send({ t: "lines", count: lines });
    }
  });

  const response = await stream.finalMessage();
  logUsage("design", response.usage);

  if (response.stop_reason === "refusal") {
    send({ t: "error", error: "I'd rather not make that one. Want to try a different idea?" });
    return null;
  }

  if (response.stop_reason === "max_tokens") {
    console.error("[design] hit max_tokens before finishing the answer");
    send({
      t: "error",
      error: "That one got away from me — it ran long and I lost the thread. Try asking for a bit less at once.",
    });
    return null;
  }

  // The parsed copy has already had any unknown icon corrected, so the raw text is the
  // only place left that remembers what was actually asked for.
  reportIconDrift(json);

  const parsed = response.parsed_output;
  if (!parsed) {
    send({ t: "error", error: "My answer came out muddled. Please ask me again!" });
    return null;
  }

  // A turn that asks carries no model, so it short-circuits everything below — no checks, no
  // repair pass, and nothing that would replace what's already on screen.
  if (parsed.action === "ask") {
    send({
      t: "ask",
      question: normalizeText(parsed.question),
      options: parsed.options.map((option) => ({
        label: normalizeText(option.label),
        prompt: normalizeText(option.prompt),
      })),
    });
    return null;
  }

  let code = stripFences(parsed.code);

  // The cheap review. Only certain failures get here, so a hit is always worth a second pass.
  send({ t: "stage", stage: "checking" });
  const problems = findProblems(code);

  if (problems.length) {
    console.log(`[design] pre-flight found ${problems.length} problem(s), repairing`);
    send({ t: "stage", stage: "fixing" });
    send({ t: "note", text: problems[0].friendly });

    const fixed = await repairCode({
      code,
      fault: problems.map((problem) => problem.detail).join("\n"),
      goal: parsed.description,
      patternIds: patterns.ids,
      send,
      signal,
    });
    // A failed repair isn't fatal — the browser will report the real error and offer a fix.
    if (fixed) code = stripFences(fixed.code);
  }

  for (const note of findAdvice(code)) send({ t: "note", text: note });

  // ...and models sometimes emit "🧊" as literal text instead of the emoji it encodes.
  return {
    // What this build is made from, so the turn after this one still knows. Nothing else
    // can work it out: the agent is told to paste these in and rename them.
    patternIds: patterns.ids,
    name: normalizeText(parsed.name),
    description: normalizeText(parsed.description),
    summary: normalizeText(parsed.summary),
    steps: parsed.steps.map((step) => ({
      // icon is schema-validated, so only the prose can still carry stray escapes.
      icon: step.icon,
      title: normalizeText(step.title),
      why: normalizeText(step.why),
    })),
    code,
    requirements: parsed.requirements.map((requirement) => ({
      text: normalizeText(requirement.text),
      done: requirement.done,
    })),
    checkpoint: {
      look: normalizeText(parsed.checkpoint.look),
      directions: parsed.checkpoint.directions.map((direction) => ({
        label: normalizeText(direction.label),
        prompt: normalizeText(direction.prompt),
      })),
    },
  };
}
