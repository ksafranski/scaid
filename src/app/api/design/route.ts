import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { normalizeText } from "@/lib/emoji";
import { ICON_NAMES } from "@/lib/iconNames";
import { encodeEvent, type AgentEvent } from "@/lib/agentEvents";
import { StreamedFields } from "@/lib/partialJson";
import { findAdvice, findProblems } from "@/lib/scadLint";

// 300s is the platform maximum on Hobby and the default everywhere. Real requests land
// at 30-50s; the headroom is for a complex model, not an expectation.
export const maxDuration = 300;

// One client for the lifetime of the server process, not one per request.
const client = new Anthropic();

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

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
  action: z
    .enum(["ask", "build"])
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
        icon: z
          .enum(ICON_NAMES)
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
line. Not that you meant to, not that it's nearly there. A requirement marked done that isn't is
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
  installed and will fail.
- **No text().** This build ships no fonts, so any lettering fails with "Can't get font" and there is
  nothing they can do about it. Never write it, and never offer letters, names or numbers as a
  direction — carve a recognizable shape instead.
- Sizes are millimeters. Keep the whole model roughly 20-150mm so it fits nicely on screen.
- Build the model sitting on the ground plane (z = 0) and centered around x = 0, y = 0.
- Set $fn between 32 and 64 near the top. Higher is slower and the preview will crawl.
- The result must be one solid, watertight shape suitable for 3D printing. Avoid zero-thickness walls
  and faces that exactly touch — overlap parts slightly (0.01mm) so they truly fuse.
- Use color() when it helps them read the separate parts. It shows up in the preview.
- Add a short comment above each part, in the same plain language as your steps, so the code reads
  like your explanation.
- Prefer simple, readable code over clever code. Someone is going to read this and learn from it.
- Write the code in the order your steps describe, so the two read together.

## When they ask for a change
You get the code you wrote last time. Change only what they asked about and keep everything else
exactly as it was, so their build stays recognizable. Put what you changed in the summary — and
rewrite the description to fit the object as it now stands, still with no mention of the change.

## When they attach a picture
The picture is what they want to make. Look at its overall shape and build a simplified 3D version out
of basic solids. Don't chase fine detail or texture; clean and chunky prints better and reads better.
Say what you spotted and what you simplified, so they know you looked.`;

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
 * Hard ceiling on the base64 image payload.
 *
 * Vercel caps a function's whole request body at 4.5MB and rejects anything larger with a
 * 413 before this handler runs — so a limit sized to Anthropic's 5MB-per-image allowance
 * would be unreachable. 3MB here leaves ~1.3MB for the prompt, the current code and the
 * conversation history. The browser aims far below this; it's a backstop for direct callers.
 */
const MAX_IMAGE_BASE64 = 3 * 1024 * 1024;

const RequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  currentCode: z.string().max(60000).optional(),
  image: z
    .object({
      mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
      data: z.string().max(MAX_IMAGE_BASE64, "That picture is too large to send. Try a smaller one."),
    })
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
  /** Present when the browser's renderer rejected code we just produced. */
  repair: z
    .object({
      code: z.string().min(1).max(60000),
      error: z.string().min(1).max(4000),
      goal: z.string().max(600).optional(),
    })
    .optional(),
});

/** Prints per-request token usage so spend (and whether caching is hitting) is observable. */
function logUsage(label: string, usage: Anthropic.Usage | undefined) {
  if (!usage) return;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  console.log(
    `[${label}] in=${usage.input_tokens} out=${usage.output_tokens} ` +
      `cache_read=${cacheRead} cache_write=${cacheWrite} ` +
      `(${cacheRead > 0 ? "cache HIT" : cacheWrite > 0 ? "cache written" : "no cache"})`,
  );
}

/** Models sometimes wrap code in markdown fences despite the schema description. */
function stripFences(code: string): string {
  return code.replace(/^\s*```(?:openscad|scad)?\n?/i, "").replace(/```\s*$/, "");
}

function friendlyApiError(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) {
    return "Lots of people are making things right now. Wait a few seconds and try again!";
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return "The ANTHROPIC_API_KEY isn't being accepted. Check it and restart.";
  }
  if (error instanceof Anthropic.APIError) {
    return "I couldn't reach my thinking brain just now. Please try again in a moment.";
  }
  return "Something went wrong while I was building that. Please try again.";
}

/**
 * Runs the repair model over a program with a known fault.
 *
 * `note` is first in the schema, so passing a `send` here means the person reads what was
 * actually wrong while the corrected code is still being written, rather than watching a
 * spinner for the whole pass.
 */
async function repairCode(args: { code: string; fault: string; goal?: string; send?: Send }) {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: REPAIR_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content:
          `What this is supposed to be: ${args.goal || "the model in the code below"}\n\n` +
          `What went wrong:\n${args.fault}\n\n` +
          `The program:\n${args.code}`,
      },
    ],
    output_config: { format: zodOutputFormat(RepairSchema) },
  });

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

  // Once bytes are on the wire the status code is already 200, so from here on every failure
  // travels as an `error` event instead. Anything that can be rejected outright is above.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (event: AgentEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      try {
        const design = body.repair ? await runRepair(body, send) : await runDesign(body, send);
        if (design) send({ t: "design", design });
      } catch (error) {
        console.error("[design] failed:", error);
        send({ t: "error", error: friendlyApiError(error) });
      } finally {
        closed = true;
        controller.close();
      }
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
async function runRepair(body: Body, send: Send) {
  const repair = body.repair!;
  send({ t: "stage", stage: "fixing" });

  const fixed = await repairCode({
    code: repair.code,
    fault: `OpenSCAD reported:\n${repair.error}`,
    goal: repair.goal,
    send,
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
async function runDesign(body: Body, send: Send) {
  const { prompt, currentCode, history, image } = body;

  let text = currentCode
    ? `Here is the code for what I have right now:\n\n${currentCode}\n\nPlease change it: ${prompt}`
    : prompt;

  // Handed back verbatim so the list belongs to the object rather than to whichever message
  // happened to start it — the model has no other way to know what it already promised.
  if (body.requirements?.length) {
    const checklist = body.requirements
      .map((requirement) => `- [${requirement.done ? "x" : " "}] ${requirement.text}`)
      .join("\n");
    text += `\n\nThe checklist for this build so far:\n${checklist}\n\nCarry every one of these forward, with its status updated for the model as it stands after this change.`;
  }

  // Images go before the text — Claude follows the instruction better in that order.
  const content: Anthropic.ContentBlockParam[] = image
    ? [
        { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
        { type: "text", text },
      ]
    : [{ type: "text", text }];

  const messages: Anthropic.MessageParam[] = [
    ...(history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user" as const, content },
  ];

  send({ t: "stage", stage: "thinking" });

  const fields = new StreamedFields();
  let json = "";
  let stage: "thinking" | "parts" | "writing" = "thinking";

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    // The system prompt is byte-identical on every request from every user, so caching it
    // means we pay full price for it roughly once per five minutes instead of every time.
    // Placed explicitly rather than via top-level cache_control, which would land the
    // breakpoint on the (always different) user turn and never hit.
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages,
    output_config: { format: zodOutputFormat(DesignSchema) },
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
      send,
    });
    // A failed repair isn't fatal — the browser will report the real error and offer a fix.
    if (fixed) code = stripFences(fixed.code);
  }

  for (const note of findAdvice(code)) send({ t: "note", text: note });

  // ...and models sometimes emit "🧊" as literal text instead of the emoji it encodes.
  return {
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
