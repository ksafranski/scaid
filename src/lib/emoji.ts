/**
 * Repairs text that came back with literal escape sequences instead of real characters.
 *
 * Claude occasionally emits `🧊` as twelve literal characters rather than the
 * ice-cube emoji it stands for — a known JSON-escaping quirk. The step icons are the most
 * visible casualty, so decode the escapes and fall back to a neutral icon if what's left
 * still isn't something a browser can draw.
 */

/** Shown when a step's icon is missing or unusable, so a step never renders as raw text. */
const FALLBACK_ICON = "🧩";

/** Decodes literal \uXXXX and \u{XXXXX} sequences. Adjacent surrogates re-pair naturally. */
export function decodeEscapes(value: string): string {
  return value
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (whole, hex: string) => {
      const point = parseInt(hex, 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** True when the string contains something that will actually draw as a picture. */
function isRenderable(value: string): boolean {
  if (!value) return false;
  // Lone surrogates survive a bad decode and render as a replacement box.
  if (/[\uD800-\uDFFF]/.test(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""))) return false;
  return /\p{Extended_Pictographic}/u.test(value);
}

export function normalizeIcon(value: unknown): string {
  if (typeof value !== "string") return FALLBACK_ICON;
  const decoded = decodeEscapes(value).trim();
  return isRenderable(decoded) ? decoded : FALLBACK_ICON;
}

/** Same repair for prose, where there's no icon to fall back to. */
export function normalizeText(value: unknown): string {
  return typeof value === "string" ? decodeEscapes(value) : "";
}
