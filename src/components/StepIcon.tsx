"use client";

import {
  AlignBottom,
  ArrowsClockwise,
  Circle,
  Cube,
  CubeTransparent,
  Cylinder,
  Drop,
  FlipHorizontal,
  Hexagon,
  Intersect,
  Palette,
  Path,
  Printer,
  Repeat,
  Resize,
  Ruler,
  Sparkle,
  Sphere,
  Square,
  Stack,
  Subtract,
  Triangle,
  Unite,
  type Icon,
} from "@phosphor-icons/react";
import { FALLBACK_ICON, isIconName, type IconName } from "@/lib/iconNames";

/**
 * Color carries meaning here: the hue tells you what *kind* of step it is at a glance —
 * a shape, a way of combining shapes, a movement, or a finishing touch.
 */
type Tone = "solid" | "operation" | "transform" | "craft";

const TONE_CLASS: Record<Tone, string> = {
  solid: "text-cyan-400",
  operation: "text-violet-400",
  transform: "text-amber-400",
  craft: "text-emerald-400",
};

const REGISTRY: Record<IconName, { Glyph: Icon; tone: Tone }> = {
  cube: { Glyph: Cube, tone: "solid" },
  sphere: { Glyph: Sphere, tone: "solid" },
  cylinder: { Glyph: Cylinder, tone: "solid" },
  cone: { Glyph: Triangle, tone: "solid" },
  ring: { Glyph: Circle, tone: "solid" },
  hexagon: { Glyph: Hexagon, tone: "solid" },
  slab: { Glyph: Square, tone: "solid" },

  cut: { Glyph: Subtract, tone: "operation" },
  join: { Glyph: Unite, tone: "operation" },
  hollow: { Glyph: CubeTransparent, tone: "operation" },
  overlap: { Glyph: Intersect, tone: "operation" },

  repeat: { Glyph: Repeat, tone: "transform" },
  mirror: { Glyph: FlipHorizontal, tone: "transform" },
  rotate: { Glyph: ArrowsClockwise, tone: "transform" },
  resize: { Glyph: Resize, tone: "transform" },
  stack: { Glyph: Stack, tone: "transform" },
  ground: { Glyph: AlignBottom, tone: "transform" },

  measure: { Glyph: Ruler, tone: "craft" },
  color: { Glyph: Palette, tone: "craft" },
  smooth: { Glyph: Drop, tone: "craft" },
  print: { Glyph: Printer, tone: "craft" },
  detail: { Glyph: Sparkle, tone: "craft" },
  path: { Glyph: Path, tone: "craft" },
};

export function StepIcon({ name, size = 22 }: { name?: string; size?: number }) {
  const key = isIconName(name) ? name : FALLBACK_ICON;
  const { Glyph, tone } = REGISTRY[key];

  // Duotone gives the set a consistent, deliberate look — the secondary fill reads as a
  // tinted shadow rather than the flat clip-art of an emoji.
  return <Glyph size={size} weight="duotone" className={TONE_CLASS[tone]} aria-hidden />;
}
