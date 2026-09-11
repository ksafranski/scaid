/**
 * Cutting the model open so you can see inside it.
 *
 * The thing people most want to know about a printed part is how thick its walls are, and
 * that is the one measurement this app deliberately doesn't calculate — every cheap
 * approximation of wall thickness averages a thick base with a thin fin and reports
 * neither. So instead of computing it, we cut the model in half and let the ruler measure
 * the exposed face directly. A real number, in a real place, with no new arithmetic.
 *
 * The cut is done by OpenSCAD rather than by clipping the mesh afterwards, which means the
 * cut face is real geometry: solid where the part is solid, hollow where it's hollow. A
 * viewer-side clipping plane would show an open shell and answer nothing.
 */
import type { Bounds } from "./inspect";

export type Axis = "x" | "y" | "z";

export interface Section {
  axis: Axis;
  /** Everything past this point on the axis is taken away. In plate millimeters. */
  position: number;
}

/**
 * The name the whole program gets wrapped in.
 *
 * Verified against the real compiler: wrapping a program in a module and calling it
 * produces a mesh identical to the unwrapped one, across top-level `$fn`, top-level
 * assignments, nested module and function definitions, and top-level `difference()`.
 * `scadLint` reserves this name so a program that defines it is caught rather than
 * silently shadowed.
 */
export const SECTION_MODULE = "__scaid_section_model";

/**
 * How far past the model the cutting box extends.
 *
 * It only has to clear the model; the size is otherwise arbitrary, and keeping it
 * proportional means a 10mm keychain and a 300mm bracket both cut cleanly.
 */
const MARGIN_FACTOR = 0.5;
const MIN_MARGIN_MM = 10;

/**
 * The narrowest slice worth rendering.
 *
 * A cut placed exactly on a face removes the entire model and OpenSCAD reports "compiled
 * but produced no geometry" — technically correct and useless to look at. Callers clamp
 * the slider with `sectionRange` so this can't be reached by dragging.
 */
const MIN_SLICE_MM = 0.05;

/** The span the slider runs over: inside the model, never at either face. */
export function sectionRange(bounds: Bounds, axis: Axis): { min: number; max: number } {
  const low = bounds.min[axis];
  const high = bounds.max[axis];
  // A model thinner than two slices has nothing to cut; the caller disables the control.
  if (high - low <= MIN_SLICE_MM * 2) return { min: low, max: high };
  return { min: low + MIN_SLICE_MM, max: high - MIN_SLICE_MM };
}

/** Where a freshly opened section starts: straight down the middle. */
export function defaultPosition(bounds: Bounds, axis: Axis): number {
  const { min, max } = sectionRange(bounds, axis);
  return (min + max) / 2;
}

/**
 * Which way to cut first.
 *
 * Always a vertical slice — X or Y, never Z. Cutting on Z takes the top off, and while
 * that is a cut, it isn't what "cut it open" means to anyone: the view people want is the
 * one that runs down through the object and shows its walls in section, the way a cutaway
 * drawing does. Z stays one click away for when someone wants a level.
 *
 * Between the two, the wider one, because that's the face with more to see on it.
 */
export function startingAxis(bounds: Bounds): Axis {
  return bounds.max.x - bounds.min.x >= bounds.max.y - bounds.min.y ? "x" : "y";
}

/**
 * The program, rewritten to render only the part of itself on one side of a plane.
 *
 * The original source is never modified on disk or in the editor — this is a view of it,
 * composed for one render and thrown away. Downloads and the spec always use the real code.
 */
export function sectionSource(code: string, section: Section, bounds: Bounds): string {
  const span = Math.max(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z,
  );
  const margin = Math.max(span * MARGIN_FACTOR, MIN_MARGIN_MM);

  const low = {
    x: bounds.min.x - margin,
    y: bounds.min.y - margin,
    z: bounds.min.z - margin,
  };
  const size = {
    x: bounds.max.x - bounds.min.x + margin * 2,
    y: bounds.max.y - bounds.min.y + margin * 2,
    z: bounds.max.z - bounds.min.z + margin * 2,
  };

  // The box starts at the cut and runs out past the far face, so what's removed is
  // everything beyond the plane and nothing else.
  low[section.axis] = section.position;
  size[section.axis] = bounds.max[section.axis] + margin - section.position;

  const round = (value: number) => Number(value.toFixed(4));

  return (
    `module ${SECTION_MODULE}() {\n${code}\n}\n\n` +
    `difference() {\n` +
    `  ${SECTION_MODULE}();\n` +
    `  translate([${round(low.x)}, ${round(low.y)}, ${round(low.z)}])\n` +
    `    cube([${round(size.x)}, ${round(size.y)}, ${round(size.z)}]);\n` +
    `}\n`
  );
}
