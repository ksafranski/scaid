/**
 * A build written up as a document: the picture, the numbers, the reasoning and the source.
 *
 * The studio shows all of this already, but scattered across a conversation, a toolbar and a
 * code panel. A spec is the same material laid out as one thing you can hand to someone else
 * — pasted into a doc, or saved next to the STL — so the three renderings below all come from
 * a single assembled document rather than each re-reading the studio's state.
 */
import { normalizeText } from "./emoji";
import { markdownToHtml, markdownToPlainText, parseMarkdown } from "./markdown";
import type { BuildStep } from "./types";
import type { ModelSize } from "@/hooks/useScadRenderer";
import { factRows } from "@/lib/geometry/facts";
import type { GeometryReport } from "@/lib/geometry/inspect";

const MM_PER_INCH = 25.4;

export interface SpecMeasurement {
  label: string;
  value: string;
  /** Set when the number is a problem rather than just a fact — it won't fit the plate. */
  warn?: boolean;
}

/** What a spec needs from the studio. Satisfied by a live design and by a saved creation. */
export interface SpecSource {
  name: string;
  description?: string;
  summary: string;
  steps: BuildStep[];
  code: string;
}

export interface SpecDocument {
  name: string;
  description: string;
  /** The maker's own write-up, as Markdown. Empty when they haven't written one. */
  readme: string;
  measurements: SpecMeasurement[];
  steps: BuildStep[];
  code: string;
  /** A PNG data URL of the model as it was posed, or null if the viewer couldn't be read. */
  image: string | null;
  /** False when the model hasn't built, so the write-up says so instead of guessing. */
  measured: boolean;
}

/** Same rounding as the toolbar readout, so the document agrees with what's on screen. */
function round(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

/** Millimeters, with inches alongside — a spec gets read by people using either. */
function span(value: number): string {
  return `${round(value)} mm (${(value / MM_PER_INCH).toFixed(2)} in)`;
}

export function buildSpec({
  design,
  size,
  metrics,
  plateSizeMm,
  image,
  readme,
}: {
  design: SpecSource;
  size: ModelSize | null;
  metrics: GeometryReport | null;
  plateSizeMm: number;
  image: string | null;
  readme: string;
}): SpecDocument {
  const overhangs = size ? size.x > plateSizeMm || size.y > plateSizeMm : false;

  const measurements: SpecMeasurement[] = [
    ...(size
      ? [
          { label: "Width (X)", value: span(size.x) },
          { label: "Depth (Y)", value: span(size.y) },
          { label: "Height (Z)", value: span(size.z) },
        ]
      : []),
    { label: "Build plate", value: `${plateSizeMm} × ${plateSizeMm} mm` },
    ...(size
      ? [
          {
            label: "Fits the plate",
            value: overhangs ? "No — wider than the plate" : "Yes",
            warn: overhangs,
          },
        ]
      : []),
    // The rest of what the mesh was measured for. Already in the shape this list wants,
    // so the three renderings below pick them up without knowing anything new.
    ...(metrics ? factRows(metrics) : []),
  ];

  return {
    name: normalizeText(design.name),
    // The description is what the object *is*; the summary is what changed last turn, and
    // only stands in for builds saved before the two were split apart.
    description: normalizeText(design.description?.trim() || design.summary),
    readme: readme.trim(),
    measurements,
    steps: design.steps.map((step) => ({
      ...step,
      title: normalizeText(step.title),
      why: normalizeText(step.why),
    })),
    code: design.code,
    image,
    measured: size !== null,
  };
}

const NOT_MEASURED = "The model hasn't built yet, so it has no measurements.";

/**
 * What the readme is called once it's part of the spec.
 *
 * Labelled rather than just dropped in, because a document that opens with two blocks of
 * prose needs to say which of them is the person talking and which is the machine.
 */
const README_TITLE = "About this project";

/**
 * The document as Markdown, with the picture as a file beside it.
 *
 * `imagePath` is relative to the Markdown file rather than embedded as a data URL: a spec
 * runs to a couple of hundred lines and a base64 PNG in the middle of it makes the file
 * unreadable in the editor it's most likely to be opened in.
 */
export function toMarkdown(spec: SpecDocument, imagePath: string | null): string {
  const lines: string[] = [`# ${spec.name}`, "", spec.description, ""];

  // Verbatim, headings and all. This is the one rendering that has to survive a round trip
  // back into an editor, so nothing the reader here doesn't understand — a table, a nested
  // list, an image of their own — can be quietly dropped on the way to the file.
  if (spec.readme) lines.push(`## ${README_TITLE}`, "", spec.readme, "");

  if (imagePath) lines.push(`![${spec.name}](${imagePath})`, "");

  lines.push("## Key measurements", "");
  if (spec.measured) {
    lines.push("| Measurement | Value |", "| --- | --- |");
    for (const item of spec.measurements) lines.push(`| ${item.label} | ${item.value} |`);
  } else {
    lines.push(NOT_MEASURED);
  }
  lines.push("");

  if (spec.steps.length) {
    lines.push("## How it's built", "");
    spec.steps.forEach((step, index) => {
      lines.push(`${index + 1}. **${step.title}** — ${step.why}`);
    });
    lines.push("");
  }

  lines.push("## OpenSCAD code", "", "```openscad", spec.code.trimEnd(), "```", "");
  return lines.join("\n");
}

/**
 * The document as plain text.
 *
 * The fallback flavour on the clipboard, for anywhere that won't take the HTML one. It's
 * deliberately not the Markdown: pasted somewhere that doesn't render it, `## Heading` and
 * `**bold**` are punctuation in the reader's way.
 */
export function toPlainText(spec: SpecDocument): string {
  const lines: string[] = [spec.name, "=".repeat(spec.name.length), "", spec.description, ""];

  if (spec.readme) {
    lines.push(README_TITLE.toUpperCase(), "", markdownToPlainText(parseMarkdown(spec.readme)), "");
  }

  lines.push("KEY MEASUREMENTS", "");
  if (spec.measured) {
    for (const item of spec.measurements) lines.push(`${item.label}: ${item.value}`);
  } else {
    lines.push(NOT_MEASURED);
  }
  lines.push("");

  if (spec.steps.length) {
    lines.push("HOW IT'S BUILT", "");
    spec.steps.forEach((step, index) => lines.push(`${index + 1}. ${step.title} — ${step.why}`));
    lines.push("");
  }

  lines.push("OPENSCAD CODE", "", spec.code.trimEnd(), "");
  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The document as HTML, for the clipboard.
 *
 * Written for a word processor, not for this app: black on white, ordinary fonts, and
 * styling inline on every element. Word processors keep inline styles and throw away
 * stylesheets and class names, and they paste onto a white page — the studio's dark theme
 * would arrive as unreadable pale text on it.
 */
export function toHtml(spec: SpecDocument): string {
  const font = "font-family: Arial, Helvetica, sans-serif; color: #111111;";
  const heading = "font-family: Arial, Helvetica, sans-serif; color: #111111; margin: 20px 0 8px;";
  const cell = "border: 1px solid #cccccc; padding: 6px 10px; text-align: left;";

  const parts: string[] = [
    `<div style="${font}">`,
    `<h1 style="${heading} font-size: 22pt;">${escapeHtml(spec.name)}</h1>`,
    `<p style="${font} line-height: 1.5;">${escapeHtml(spec.description)}</p>`,
  ];

  // Data URLs survive a paste in some editors and are dropped by others; the picture also
  // travels in the Markdown export, which is the dependable route for it.
  if (spec.image) {
    parts.push(
      `<p><img src="${spec.image}" alt="${escapeHtml(spec.name)}" width="640" /></p>`,
    );
  }

  if (spec.readme) {
    parts.push(`<h2 style="${heading} font-size: 14pt;">${README_TITLE}</h2>`);
    // The readme's own headings are pushed a level below this one, so a readme that opens
    // with `# My Project` reads as part of the spec rather than as a rival title.
    parts.push(markdownToHtml(parseMarkdown(spec.readme), { font, headingOffset: 2 }));
  }

  parts.push(`<h2 style="${heading} font-size: 14pt;">Key measurements</h2>`);
  if (spec.measured) {
    parts.push('<table style="border-collapse: collapse; margin-bottom: 8px;">');
    for (const item of spec.measurements) {
      parts.push(
        `<tr><td style="${cell}"><b>${escapeHtml(item.label)}</b></td><td style="${cell}">${escapeHtml(item.value)}</td></tr>`,
      );
    }
    parts.push("</table>");
  } else {
    parts.push(`<p style="${font}">${NOT_MEASURED}</p>`);
  }

  if (spec.steps.length) {
    parts.push(`<h2 style="${heading} font-size: 14pt;">How it&rsquo;s built</h2>`);
    // The indent is not decoration: without it the numbers sit outside the list's box and
    // get clipped away, which turns a sequence into an unordered pile.
    parts.push(
      `<ol style="${font} line-height: 1.5; list-style: decimal outside; padding-left: 24px;">`,
    );
    for (const step of spec.steps) {
      parts.push(`<li><b>${escapeHtml(step.title)}</b> &mdash; ${escapeHtml(step.why)}</li>`);
    }
    parts.push("</ol>");
  }

  parts.push(`<h2 style="${heading} font-size: 14pt;">OpenSCAD code</h2>`);
  parts.push(
    `<pre style="font-family: 'Courier New', Courier, monospace; font-size: 9pt; line-height: 1.45; color: #111111; background: #f6f6f6; border: 1px solid #dddddd; padding: 12px; white-space: pre-wrap;">${escapeHtml(spec.code.trimEnd())}</pre>`,
  );

  parts.push("</div>");
  return parts.join("\n");
}

/** Turns the snapshot's data URL back into the bytes that go in the download. */
export function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1 || !dataUrl.slice(0, comma).includes(";base64")) return null;

  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}
