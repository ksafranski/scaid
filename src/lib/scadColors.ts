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

/** Every color explicitly requested by color(...) calls in an OpenSCAD program. */
export function extractRequestedColors(code: string): Color[] {
  const found: Color[] = [];

  // color("red") / color("#ff8800")
  for (const match of code.matchAll(/\bcolor\s*\(\s*"([^"]+)"/g)) {
    const rgb = cssToRgb(match[1].trim());
    if (rgb) found.push([...rgb, 1]);
  }

  // color([r, g, b]) with components in 0..1
  for (const match of code.matchAll(/\bcolor\s*\(\s*\[([^\]]+)\]/g)) {
    const parts = match[1].split(",").map((part) => parseFloat(part.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => !isNaN(part))) {
      found.push([parts[0], parts[1], parts[2], 1]);
    }
  }

  return found;
}
