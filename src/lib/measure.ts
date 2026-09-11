/**
 * A point on the model, in millimeters, read off the build plate.
 *
 * X and Y run along the plate from its middle — the crossing of the two bright axes, which
 * is also OpenSCAD's origin — and Z runs straight up from the plate's surface. Those are the
 * numbers someone holding the printed part would take with calipers, which is the point:
 * "12mm from the middle, 8mm up" is checkable, while a figure in scene units is not.
 */
export interface PlatePoint {
  x: number;
  y: number;
  z: number;
}

/**
 * One end of a measurement: where it is, and which way the surface faces there.
 *
 * The facing is carried along so the viewer can tell a point on the near side of the model
 * from one on the far side once it has been turned around. Without it a reading taken on the
 * front would keep drawing itself on the front after a half turn, over surfaces it was never
 * taken from.
 */
export interface Spot {
  at: PlatePoint;
  /** A direction, not a length: the surface normal on the same axes as the plate. */
  facing: PlatePoint;
  /**
   * Set when this landed on a corner of the model rather than wherever the ray happened
   * to hit. Worth recording: a reading taken between two corners is a measurement of the
   * object, and one taken between two points near them is a measurement of the click.
   */
  snapped?: boolean;
}

/**
 * One thing measured on the model.
 *
 * Unlike a mark, this lives in the model's own coordinates rather than on the screen, so it
 * stays on the spot it was taken from however the model is turned afterwards.
 */
export interface Measurement {
  id: number;
  from: Spot;
  /** Null when the measurement names a single spot rather than a span between two. */
  to: Spot | null;
}

export const MEASURE_COLOR = "#31e0c4";

/**
 * Millimeters per scene unit.
 *
 * The GLB is written at 1mm = 0.001 units and the model is dropped so its underside sits on
 * the plate at z = 0 — see `exportGlb`. Both halves of that have to hold for these readings
 * to mean anything, so they're converted in one place.
 */
const MM_PER_UNIT = 1000;

/** Turns a hit in the viewer's model space into a spot on the plate. */
export function toSpot(hit: {
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}): Spot {
  return {
    at: {
      x: hit.position.x * MM_PER_UNIT,
      y: hit.position.y * MM_PER_UNIT,
      z: hit.position.z * MM_PER_UNIT,
    },
    // Already a unit direction, and scaling a direction by the units would say nothing.
    facing: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
  };
}

/**
 * How near a click has to land before it counts as meaning a corner.
 *
 * In pixels, converted to millimeters against the current zoom by the viewer, so it stays
 * the same distance under the finger whether the model fills the screen or sits in the
 * middle of it.
 */
export const SNAP_PIXELS = 14;

/**
 * The corner a reading meant, if it meant one.
 *
 * A measurement is only worth taking if it lands where you intended, and a ray hits
 * wherever it hits — a couple of pixels off a corner is a couple of millimeters off the
 * answer, with nothing on screen to say so. Corners are the points a caliper would find,
 * and they are the ones the mesh actually knows: every other feature a person would want
 * to measure from, an edge or the middle of a hole, has to be inferred from triangles that
 * were never told they formed one. Those are a separate problem, not a larger version of
 * this one.
 *
 * Vertices arrive as the renderer produced them, where the model has not yet been dropped
 * onto the plate — the same shift `exportGlb` applies, undone here so both sides are
 * talking about the same point.
 */
export function snapTo(
  point: PlatePoint,
  vertices: ReadonlyArray<{ x: number; y: number; z: number }>,
  lowestZ: number,
  toleranceMm: number,
): PlatePoint | null {
  if (!vertices.length || !(toleranceMm > 0)) return null;

  let nearest: PlatePoint | null = null;
  let nearestDistance = toleranceMm;

  for (const v of vertices) {
    const dx = v.x - point.x;
    const dy = v.y - point.y;
    const dz = v.z - lowestZ - point.z;
    // Compared squared against squared: a square root per vertex, over a mesh this size,
    // to find a minimum that squaring preserves.
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = { x: v.x, y: v.y, z: v.z - lowestZ };
    }
  }

  return nearest;
}

/** What a two-point measurement works out to. */
export interface Span {
  /** Straight through the air, corner to corner. */
  distance: number;
  dx: number;
  dy: number;
  dz: number;
  /** The same distance with the height taken out — what it covers on the plate. */
  run: number;
  /** Degrees the span climbs away from the plate: 0 lies flat on it, 90 stands straight up. */
  tilt: number;
  /** Degrees around the plate from the X axis, turning towards Y. */
  heading: number;
}

export function span(measurement: Measurement): Span | null {
  if (!measurement.to) return null;
  const from = measurement.from.at;
  const to = measurement.to.at;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const run = Math.hypot(dx, dy);
  const distance = Math.hypot(run, dz);

  return {
    distance,
    dx,
    dy,
    dz,
    run,
    // atan2 rather than asin: it stays honest for a span with no run at all, which is
    // exactly the straight-up case someone measuring a wall height will hit first.
    tilt: (Math.atan2(dz, run) * 180) / Math.PI,
    heading: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/** Where a single spot sits on the plate, in the terms the plate itself suggests. */
export interface Place {
  /** How far out from the middle of the plate, ignoring height. */
  radius: number;
  /** Degrees around the plate from the X axis, turning towards Y. */
  heading: number;
  /** Height above the plate. */
  height: number;
}

export function place(point: PlatePoint): Place {
  return {
    radius: Math.hypot(point.x, point.y),
    heading: (Math.atan2(point.y, point.x) * 180) / Math.PI,
    height: point.z,
  };
}

/**
 * A length in millimeters, to a hundredth.
 *
 * Two places everywhere rather than a digit that comes and goes with the magnitude: these
 * numbers are read in columns and next to each other, and a 3.25mm pin is a different pin
 * from a 3.3mm one.
 */
export function mm(value: number): string {
  // "-0.00" is a rounding artifact, and it reads as a real negative.
  return value.toFixed(2).replace(/^-(0\.00)$/, "$1");
}

export function deg(value: number): string {
  return `${value.toFixed(1)}°`;
}

/** A point written the way the panel and the on-screen labels both want it. */
export function coords(point: PlatePoint): string {
  return `${mm(point.x)}, ${mm(point.y)}, ${mm(point.z)}`;
}
