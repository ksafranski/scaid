import type { Color } from "@/io/common";

/**
 * OpenSCAD stamps its own default colors onto geometry — a yellow body, and a distinct
 * shade on the surfaces left behind by difference(). Those leak into the OFF export and
 * show up as random yellow/green patches, which looks broken to a child.
 *
 * Rather than guessing at a list of OpenSCAD's internal defaults, we read the colors the
 * program actually asked for out of the source. Anything else is a default and gets
 * neutralized to plain gray by the OFF importer.
 */

let canvasContext: CanvasRenderingContext2D | null = null;

function getContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  canvasContext ??= document.createElement("canvas").getContext("2d");
  return canvasContext;
}

/** Resolves any CSS color the browser understands ("red", "#ff8800", "steelblue"). */
function cssToRgb(value: string): [number, number, number] | null {
  const ctx = getContext();
  if (!ctx) return null;

  // An invalid value leaves fillStyle untouched, so test against two different sentinels.
  ctx.fillStyle = "#000000";
  ctx.fillStyle = value;
  const fromBlack = ctx.fillStyle;

  ctx.fillStyle = "#ffffff";
  ctx.fillStyle = value;
  if (fromBlack !== ctx.fillStyle) return null;

  const hex = /^#([0-9a-f]{6})$/i.exec(fromBlack);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(fromBlack);
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => parseFloat(part));
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => !isNaN(part))) {
      return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
    }
  }
  return null;
}

/**
 * A colour as the program wrote it, before any of it means anything.
 *
 * Split out from resolving it so the reading can be checked away from a browser: turning
 * "steelblue" into numbers needs a canvas, and working out that the program asked for
 * steelblue at all does not.
 */
export interface RequestedColor {
  /** A CSS name or hex, as written. */
  css?: string;
  /** Components in 0..1, when the program gave a vector. */
  rgb?: [number, number, number];
}

/** Comments gone, strings intact — a colour lives inside a string and must survive. */
function stripComments(code: string): string {
  let out = "";
  let inString = false;

  for (let i = 0; i < code.length; i++) {
    const here = code[i];
    const next = code[i + 1];

    if (inString) {
      out += here;
      if (here === "\\") {
        out += next ?? "";
        i++;
      } else if (here === '"') {
        inString = false;
      }
      continue;
    }

    if (here === '"') {
      inString = true;
      out += here;
      continue;
    }

    if (here === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      out += "\n";
      continue;
    }

    if (here === "/" && next === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i++;
      out += " ";
      continue;
    }

    out += here;
  }

  return out;
}

function readLiteral(literal: string): RequestedColor | null {
  const text = literal.trim();

  if (text.startsWith('"')) {
    const value = text.slice(1, -1).trim();
    return value ? { css: value } : null;
  }

  if (text.startsWith("[")) {
    const parts = text.slice(1, -1).split(",").map((part) => parseFloat(part.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => !isNaN(part))) {
      return { rgb: [parts[0], parts[1], parts[2]] };
    }
  }

  return null;
}

/**
 * Every colour a program asks for, including the ones it asks for by name.
 *
 * Reading only `color("blue")` was enough until programs started keeping their settings at
 * the top, where a colour is a named value and the call site says `color(shade)`. That is
 * the shape the studio now asks the agent to write, so it became the common one — and a
 * colour that isn't recognised here is flattened to grey by the importer, which made
 * choosing a colour look broken.
 *
 * So a name passed to `color()` is looked up among the program's own assignments. Only
 * names actually used that way are resolved: a setting called `finish` holding "gold" is
 * not a colour request unless something colours with it.
 */
export function requestedColors(code: string): RequestedColor[] {
  const source = stripComments(code);
  const found: RequestedColor[] = [];

  const LITERAL = String.raw`"(?:[^"\\]|\\.)*"|\[[^\]]*\]`;

  // color("red") and color([r, g, b]) — written where they're used.
  for (const match of source.matchAll(new RegExp(String.raw`\bcolor\s*\(\s*(${LITERAL})`, "g"))) {
    const colour = readLiteral(match[1]);
    if (colour) found.push(colour);
  }

  // color(shade), where the program said what shade is somewhere above.
  const named = new Map<string, string>();
  for (const match of source.matchAll(
    new RegExp(String.raw`(^|[;{}\n])\s*([A-Za-z_]\w*)\s*=\s*(${LITERAL})\s*;`, "gm"),
  )) {
    // First assignment wins, the way reading down the file suggests.
    if (!named.has(match[2])) named.set(match[2], match[3]);
  }

  for (const match of source.matchAll(/\bcolor\s*\(\s*([A-Za-z_]\w*)\s*[,)]/g)) {
    const literal = named.get(match[1]);
    const colour = literal ? readLiteral(literal) : null;
    if (colour) found.push(colour);
  }

  return found;
}

/**
 * The names a program colours with.
 *
 * Which settings are colours, told by what the program does with them rather than by what
 * they are called. A value is a colour because something is painted with it — `shade` and
 * `body_tint` and `c` all qualify on the same evidence, and a setting called `colour_scheme`
 * that nothing paints with does not.
 */
export function colourParameterNames(code: string): string[] {
  const source = stripComments(code);
  const names = new Set<string>();
  for (const match of source.matchAll(/\bcolor\s*\(\s*([A-Za-z_]\w*)\s*[,)]/g)) {
    names.add(match[1]);
  }
  return [...names];
}

/** Every color explicitly requested by color(...) calls, resolved to numbers. */
export function extractRequestedColors(code: string): Color[] {
  const found: Color[] = [];

  for (const requested of requestedColors(code)) {
    if (requested.rgb) {
      found.push([...requested.rgb, 1]);
      continue;
    }
    const rgb = requested.css ? cssToRgb(requested.css) : null;
    if (rgb) found.push([...rgb, 1]);
  }

  return found;
}
