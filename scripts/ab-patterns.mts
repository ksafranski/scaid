/**
 * Asks the design agent for the same thing twice — once with the pattern library in the
 * prompt, once without — and renders both answers.
 *
 * The pattern library's whole claim is that a worked technique beats an improvised one. This
 * is how that claim gets checked against the actual model rather than argued about. It costs
 * two Opus calls per run, so it isn't wired into anything that runs automatically.
 *
 *   npm run ab:patterns
 *   npm run ab:patterns "a geared hand crank that turns a dial"
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { PATTERN_INDEX, patternBrief } from "../src/lib/scadPatterns/prompt";
import { findProblems } from "../src/lib/scadLint";
import { render } from "./lib/scad-render.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

// Values may be quoted, and a key can appear twice with the last one winning — both of which
// dotenv handles for the app but nothing handles here.
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (!match) continue;
  const value = match[2].trim().replace(/^["'](.*)["']$/, "$1");
  if (value) process.env[match[1]] = value;
}

/**
 * Only the code rules, not the whole studio prompt.
 *
 * The variable under test is the pattern library, so everything about tone, staging and
 * checkpoints is left out — it would only add noise to the comparison.
 */
const BASE = `You are Scaid, a 3D design partner. Write correct OpenSCAD.
- Use ONLY built-in OpenSCAD features. No include<>, no use<> — nothing is installed.
- No text(). Sizes in millimeters. The model sits on z = 0, centred on x = 0, y = 0.
- Set $fn between 32 and 64 near the top.
- One solid, watertight, printable shape. Overlap touching parts by 0.01mm.`;

const Schema = z.object({
  summary: z.string().describe("One or two sentences on what you built."),
  code: z.string().describe("The complete OpenSCAD program. Nothing else — no fences."),
});

const request = process.argv[2] ?? "a small jar about 60mm across with a lid that screws on";
const client = new Anthropic();

async function ask(label: string, withPatterns: boolean) {
  const brief = withPatterns ? patternBrief({ prompt: request }) : { text: "", ids: [] };
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5",
    max_tokens: 16000,
    system: [
      { type: "text", text: withPatterns ? `${BASE}\n\n${PATTERN_INDEX}` : BASE },
      ...(brief.text ? [{ type: "text" as const, text: brief.text }] : []),
    ],
    messages: [{ role: "user", content: request }],
    output_config: { format: zodOutputFormat(Schema), effort: "medium" },
  });

  const block = response.content.find((part) => part.type === "text");
  const answer = JSON.parse((block as { text: string }).text) as { summary: string; code: string };
  const problems = findProblems(answer.code);
  const result = await render(answer.code);

  console.log(`\n===== ${label} =====`);
  if (brief.ids.length) console.log(`patterns sent : ${brief.ids.join(", ")}`);
  console.log(`lint          : ${problems.length ? problems.map((p) => p.friendly).join(" | ") : "clean"}`);
  console.log(
    `render        : ${
      "error" in result
        ? `FAILED — ${String(result.error).slice(0, 160)}`
        : `${result.volume.toFixed(0)}mm³  [${result.size.map((n: number) => n.toFixed(1)).join(", ")}]  ${result.ms}ms`
    }`,
  );
  console.log(`code          : ${answer.code.split("\n").length} lines`);
  console.log(`summary       : ${answer.summary}`);

  const out = path.join(ROOT, `.ab-${label}.scad`);
  fs.writeFileSync(out, answer.code);
  console.log(`written       : ${path.relative(ROOT, out)}`);
}

console.log(`Request: ${request}`);
await ask("without-patterns", false);
await ask("with-patterns", true);
