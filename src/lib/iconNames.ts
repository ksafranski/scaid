/**
 * The icon vocabulary the design agent picks from.
 *
 * Kept as a fixed list rather than letting the model emit emoji or markup: the schema
 * validates the choice, so an unknown or malformed icon can't reach the UI — which also
 * retires the whole class of "🧊 arrived as literal text" bugs.
 *
 * Names are semantic (what the step *does*), not visual, so the artwork can change without
 * touching the prompt. Plain strings with no React imports, so the API route can use them.
 */
export const ICON_NAMES = [
  // Solid shapes the model is built from
  "cube",
  "sphere",
  "cylinder",
  "cone",
  "ring",
  "hexagon",
  "slab",
  // Ways shapes are combined
  "cut",
  "join",
  "hollow",
  "overlap",
  // Ways shapes are moved or multiplied
  "repeat",
  "mirror",
  "rotate",
  "resize",
  "stack",
  "ground",
  // Craft and finishing
  "measure",
  "color",
  "smooth",
  "print",
  "detail",
  "path",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** Used for legacy saved steps and anything unrecognised. */
export const FALLBACK_ICON: IconName = "detail";

export function isIconName(value: unknown): value is IconName {
  return typeof value === "string" && (ICON_NAMES as readonly string[]).includes(value);
}
