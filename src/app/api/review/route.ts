import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { normalizeText } from "@/lib/emoji";
import { client, friendlyApiError, logUsage } from "@/lib/anthropic";
import { describeMeasurements } from "@/lib/geometry/facts";
import { MeasuredSchema } from "@/lib/geometry/measuredSchema";

/**
 * Looking at the model.
 *
 * Every other check here reads numbers off the mesh: how big it is, how much of it there is,
 * whether it is closed. Those are ground truth and they are silent about the one thing that
 * goes wrong most visibly — whether the parts ended up where they were meant to be.
 *
 * A mug whose handle is a ring hovering ten millimetres from the body is watertight, has no
 * open edges, and measures a perfectly reasonable size. So does the same mug with the handle
 * buried in the wall so there is nothing to hold. Both pass everything, and both are obvious
 * the instant anyone looks at the picture. This is the pass that looks.
 *
 * Measured over nine renders, three trials each: every real defect caught every time, and
 * nothing raised against a build that was fine. Two of the cases were ones the author had
 * labelled backwards, and this caught both of those too.
 */

// Well short of the design pass. A review is one look and a sentence.
export const maxDuration = 120;

/**
 * Reviewing is a narrow job with the answer in front of it, so it runs on a smaller model —
 * the same reasoning as the repair pass. Set ANTHROPIC_REVIEW_MODEL to move it.
 */
const MODEL = process.env.ANTHROPIC_REVIEW_MODEL || "claude-sonnet-5";

/**
 * Generous, and it has to be.
 *
 * At 2,000 and again at 6,000 some reviews spent the whole budget before writing anything
 * and came back empty — which reads as "no problem found" and is the worst way for this to
 * fail. At 10,000 none of them truncated.
 */
const MAX_TOKENS = 10_000;

const SYSTEM = `You are looking at a render of a 3D model someone is about to print, next to the
program that made it and the measurements taken off the mesh.

Your job is the one the measurements cannot do: judge whether the object in the picture is
arranged the way it was meant to be. Parts in the wrong place, parts not touching that should,
proportions that defeat the purpose, a feature that reads as a mistake.

Do not report anything the measurements already cover — size, volume, whether it is closed.
Do not invent a problem to have something to say. Most builds are fine, and saying so is the
correct answer when it is true.

The person reading this is new to 3D printing. Say what is wrong in shapes and plain words —
"the handle is floating next to the mug instead of joined to it", never "the union failed" or
"disjoint manifold". American English.`;

const LookSchema = z.object({
  looksRight: z
    .boolean()
    .describe("true when nothing is visibly wrong. This is the usual answer."),
  problem: z
    .string()
    .describe(
      "The single most important visible problem, in one plain sentence. Empty when " +
        "looksRight is true.",
    ),
  confidence: z
    .enum(["sure", "unsure"])
    .describe(
      "'sure' when the picture plainly shows it. 'unsure' when the angle hides part of the " +
        "object, or it might be deliberate.",
    ),
});

/**
 * The picture, and how large one is allowed to be.
 *
 * The studio caps its snapshot at 1600px, which is about 3,400 tokens. That is the whole
 * cost of this pass and it is worth being deliberate about: a render of one grey object on
 * a plain background carries its shape at far less than that.
 */
const MAX_IMAGE_BASE64 = 3 * 1024 * 1024;

const RequestSchema = z.object({
  code: z.string().min(1).max(60_000),
  /** What the object is meant to be, so "wrong" has something to be wrong against. */
  goal: z.string().max(600).optional(),
  prompt: z.string().max(2000).optional(),
  image: z.object({
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    data: z.string().max(MAX_IMAGE_BASE64, "That picture is too large to send."),
  }),
  /** The same measured block the design pass takes, rendered to English on this side. */
  measured: MeasuredSchema.optional(),
  plateSizeMm: z.number().int().positive().max(1000).optional(),
});

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "The design helper isn't switched on." }, { status: 503 });
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That request didn't make sense." },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Every sentence the model reads about the measurements is written here, from bounded
  // numbers — the same rule the design pass follows, so nothing the browser controls can
  // become an instruction.
  const facts = body.measured ? describeMeasurements(body.measured, body.plateSizeMm) : "";

  try {
    // parse() rather than create(): it is the same request, with the answer already
    // checked against the schema instead of arriving as text to hope about.
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            // The picture first: the model follows the instruction better when the thing
            // being talked about is already in front of it.
            {
              type: "image",
              source: { type: "base64", media_type: body.image.mediaType, data: body.image.data },
            },
            {
              type: "text",
              text:
                `They asked for: ${body.goal || body.prompt || "the object in the picture"}.\n\n` +
                `The program:\n${body.code}` +
                (facts ? `\n\n${facts}` : ""),
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(LookSchema) },
    });

    logUsage("review", response.usage);

    const look = response.parsed_output;
    // A review that couldn't answer is not a review that found nothing. Saying so lets the
    // studio stay quiet rather than quietly reporting a clean bill of health it never got.
    if (!look) return NextResponse.json({ look: null });

    return NextResponse.json({
      look: {
        looksRight: look.looksRight,
        problem: normalizeText(look.problem),
        confidence: look.confidence,
      },
    });
  } catch (error) {
    console.error("[review] failed", error);
    return NextResponse.json({ error: friendlyApiError(error) }, { status: 502 });
  }
}
