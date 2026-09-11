/**
 * Which way up to print it.
 *
 * Orientation decides whether a print succeeds more than almost anything else about it, and
 * it is the one decision a person new to this has no reason to know exists. The same shape
 * that needs scaffolding under half its surface one way up often needs none at all another
 * way, and nothing about the model has to change for that to be true.
 *
 * Judging a stance costs a pass over a mesh that's already in memory rather than another
 * compile: what rests on the plate, what hangs over it and how tall it stands all follow
 * from the vertices and which way is up. Turning the mesh is cheap; turning it in OpenSCAD
 * and waiting is not.
 *
 * The catch, found by checking rather than by reasoning: a turned mesh and a re-rendered one
 * agree exactly — until a face lands on the 45-degree line, where the last bit of floating
 * point decides which side it falls and the two disagree by a factor of two. So nothing here
 * is an answer on its own. It is a shortlist, and the one at the top of it gets compiled
 * before anyone is told about it.
 */
import { measureOnPlate, type PlateMeasurements } from "./inspect";
import type { IndexedPolyhedron, Vertex } from "@/io/common";

export type Turn = readonly [number, number, number];

/**
 * The six ways to set a model down square.
 *
 * There are twenty-four ways to turn a cube onto its axes, and eighteen of them are these
 * six spun about the vertical — which changes nothing that matters here. Overhang is the
 * angle between a face and up; what touches the plate is whatever is lowest; height is
 * measured up. Spinning a model on the spot moves none of them. (It does move the footprint
 * across the plate, which matters for fitting a long thing on a short bed — a different
 * question, deliberately not answered here.)
 */
export const STANCES: ReadonlyArray<{ turn: Turn; name: string }> = [
  { turn: [0, 0, 0], name: "as it is" },
  { turn: [180, 0, 0], name: "upside down" },
  { turn: [90, 0, 0], name: "on its back" },
  { turn: [-90, 0, 0], name: "on its front" },
  { turn: [0, 90, 0], name: "on its left side" },
  { turn: [0, -90, 0], name: "on its right side" },
];

export interface Stance {
  turn: Turn;
  /** How to say it out loud: "on its back". */
  name: string;
  overhangArea: number;
  contactArea: number;
  height: number;
  tipMargin: number | null;
  /**
   * Set when enough surface sits on the 45-degree line that this reading could go either
   * way. A stance chosen on the strength of one of these has to be compiled to be believed.
   */
  borderline: boolean;
}

/**
 * Every way of setting the model down, measured.
 *
 * The centre of mass is handed in rather than recomputed: it turns with the model like any
 * other point, and working it out again per stance would mean summing the whole volume six
 * more times for a number that a matrix multiply already gives.
 */
export function stances(
  mesh: IndexedPolyhedron,
  totalArea: number,
  centroid: { x: number; y: number; z: number } | null,
): Stance[] {
  if (!mesh.vertices.length || !mesh.faces.length) return [];

  return STANCES.map(({ turn, name }) => {
    const turned = turnVertices(mesh.vertices, turn);
    const measured: PlateMeasurements = measureOnPlate(
      turned,
      mesh.faces,
      totalArea,
      centroid ? turnPoint(centroid, turn) : null,
    );

    return {
      turn,
      name,
      overhangArea: measured.overhang.area,
      contactArea: measured.bed.contactArea,
      height: measured.size.z,
      tipMargin: measured.bed.tipMargin,
      borderline: measured.overhang.nearThresholdArea > 0,
    };
  });
}

/**
 * How much better a stance has to be before it's worth saying anything.
 *
 * Someone who has posed their model a particular way had a reason, even if the reason was
 * only that they liked it. Interrupting for a few percent teaches them to stop reading; a
 * third less scaffolding is worth a sentence.
 */
const WORTH_SAYING = 1 / 3;

/** A footing this small isn't a base, whatever the overhang numbers say about it. */
const MIN_CONTACT_MM2 = 25;

/**
 * The stance worth suggesting, or null to say nothing.
 *
 * Overhang is what's being traded away, but not at any price: a stance that removes the
 * scaffolding and leaves the model balanced on a corner has made the print worse, and one
 * that would tip over isn't printable at all. Height breaks ties, because a shorter print
 * is a faster one and has less time to go wrong.
 */
export function betterStance(all: Stance[]): Stance | null {
  const current = all.find((stance) => isUpright(stance.turn));
  if (!current) return null;

  const usable = all.filter(
    (stance) =>
      stance.contactArea >= MIN_CONTACT_MM2 &&
      (stance.tipMargin === null || stance.tipMargin > 0),
  );

  const ranked = [...usable].sort(
    (a, b) => a.overhangArea - b.overhangArea || a.height - b.height,
  );
  const best = ranked[0];
  if (!best || isUpright(best.turn)) return null;

  // Either the scaffolding goes away entirely, or a good share of it does.
  const saved = current.overhangArea - best.overhangArea;
  const worthIt =
    (current.overhangArea > 0 && best.overhangArea === 0) ||
    (current.overhangArea > 0 && saved / current.overhangArea >= WORTH_SAYING);

  return worthIt ? best : null;
}

function isUpright(turn: Turn): boolean {
  return turn[0] === 0 && turn[1] === 0 && turn[2] === 0;
}

/**
 * The program, set down the other way up.
 *
 * Wraps rather than edits, for the same reason the section view does: whatever they wrote
 * stays exactly as they wrote it, and the turn is one line that can be read and deleted.
 */
export function turnSource(code: string, turn: Turn): string {
  return `// Turned to print without support.\nrotate([${turn[0]}, ${turn[1]}, ${turn[2]}]) {\n${code}\n}\n`;
}

const RADIANS = Math.PI / 180;

/** OpenSCAD's rotate([x, y, z]) turns about X, then Y, then Z. This has to match it. */
function turnPoint(v: { x: number; y: number; z: number }, turn: Turn) {
  const [cx, sx] = [Math.cos(turn[0] * RADIANS), Math.sin(turn[0] * RADIANS)];
  const [cy, sy] = [Math.cos(turn[1] * RADIANS), Math.sin(turn[1] * RADIANS)];
  const [cz, sz] = [Math.cos(turn[2] * RADIANS), Math.sin(turn[2] * RADIANS)];

  let { x, y, z } = v;
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return { x, y, z };
}

function turnVertices(vertices: Vertex[], turn: Turn): Vertex[] {
  if (isUpright(turn)) return vertices;
  return vertices.map((v) => turnPoint(v, turn));
}
