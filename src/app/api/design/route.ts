import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { normalizeText } from "@/lib/emoji";
import { ICON_NAMES } from "@/lib/iconNames";

export const maxDuration = 120;

// One client for the lifetime of the server process, not one per request.
const client = new Anthropic();

const DesignSchema = z.object({
  name: z
    .string()
    .describe(
      "A short name for the object itself, 2-4 words, no punctuation at the end. Names the thing, " +
        "not the change — keep it the same across tweaks unless it genuinely becomes something else.",
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
    .min(1)
    .max(6)
    .describe("The build, broken into the handful of parts someone would actually notice."),
  code: z.string().describe("The complete OpenSCAD program. Nothing else — no markdown fences."),
});

const SYSTEM = `You are Scaid, a 3D design partner for people who are new to making things — think middle school and up.

You do two jobs, and both matter equally:
1. Write correct OpenSCAD code that renders into the thing they asked for.
2. Explain what you built and WHY, so they learn something and can take the next step themselves.

## Three different pieces of writing
These are not interchangeable, and mixing them up is the most common mistake here:
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
- Sizes are millimeters. Keep the whole model roughly 20-150mm so it fits nicely on screen.
- Build the model sitting on the ground plane (z = 0) and centered around x = 0, y = 0.
- Set $fn between 32 and 64 near the top. Higher is slower and the preview will crawl.
- The result must be one solid, watertight shape suitable for 3D printing. Avoid zero-thickness walls
  and faces that exactly touch — overlap parts slightly (0.01mm) so they truly fuse.
- Use color() when it helps them read the separate parts. It shows up in the preview.
- Add a short comment above each part, in the same plain language as your steps, so the code reads
  like your explanation.
- Prefer simple, readable code over clever code. Someone is going to read this and learn from it.

## When they ask for a change
You get the code you wrote last time. Change only what they asked about and keep everything else
exactly as it was, so their build stays recognizable. Put what you changed in the summary — and
rewrite the description to fit the object as it now stands, still with no mention of the change.

## When they attach a picture
The picture is what they want to make. Look at its overall shape and build a simplified 3D version out
of basic solids. Don't chase fine detail or texture; clean and chunky prints better and reads better.
Say what you spotted and what you simplified, so they know you looked.`;

/** ~5MB decoded is the API's per-image ceiling; base64 inflates by about a third. */
const MAX_IMAGE_BASE64 = Math.ceil((5 * 1024 * 1024 * 4) / 3);

const RequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  currentCode: z.string().max(60000).optional(),
  image: z
    .object({
      mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
      data: z.string().max(MAX_IMAGE_BASE64),
    })
    .optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(6000) }))
    .max(20)
    .optional(),
});

/** Prints per-request token usage so spend (and whether caching is hitting) is observable. */
function logUsage(usage: Anthropic.Usage | undefined) {
  if (!usage) return;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  console.log(
    `[design] in=${usage.input_tokens} out=${usage.output_tokens} ` +
      `cache_read=${cacheRead} cache_write=${cacheWrite} ` +
      `(${cacheRead > 0 ? "cache HIT" : cacheWrite > 0 ? "cache written" : "no cache"})`,
  );
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
  const { prompt, currentCode, history, image } = parsedBody.data;

  const text = currentCode
    ? `Here is the code for what I have right now:\n\n${currentCode}\n\nPlease change it: ${prompt}`
    : prompt;

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

  try {
    const response = await client.messages.parse({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5",
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

    logUsage(response.usage);

    if (response.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "I'd rather not make that one. Want to try a different idea?" },
        { status: 422 },
      );
    }

    const design = response.parsed_output;
    if (!design) {
      return NextResponse.json(
        { error: "My answer came out muddled. Please ask me again!" },
        { status: 502 },
      );
    }

    // Models sometimes wrap code in markdown fences despite the schema description.
    const code = design.code.replace(/^\s*```(?:openscad|scad)?\n?/i, "").replace(/```\s*$/, "");

    // ...and sometimes emit "\ud83e\uddca" as literal text instead of the emoji it encodes.
    return NextResponse.json({
      design: {
        name: normalizeText(design.name),
        description: normalizeText(design.description),
        summary: normalizeText(design.summary),
        steps: design.steps.map((step) => ({
          // icon is schema-validated, so only the prose can still carry stray escapes.
          icon: step.icon,
          title: normalizeText(step.title),
          why: normalizeText(step.why),
        })),
        code,
      },
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Lots of people are making things right now. Wait a few seconds and try again!" },
        { status: 429 },
      );
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "The ANTHROPIC_API_KEY in .env.local isn't being accepted. Check it and restart." },
        { status: 503 },
      );
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: "I couldn't reach my thinking brain just now. Please try again in a moment." },
        { status: 502 },
      );
    }
    throw error;
  }
}
