/**
 * What a rendered model actually is, measured off the mesh rather than intended.
 *
 * Everything here is a pure function of the polyhedron the renderer produced, so a number
 * out of this file is checkable: `scripts/verify-geometry.mjs` compiles known solids in the
 * same WebAssembly OpenSCAD the browser uses and asserts against closed forms. A 20mm cube
 * is 8000mm3, exactly, or this module is wrong.
 *
 * That matters more than it sounds. These measurements are handed to the design agent, and
 * an agent told the wrong size confidently builds on top of it.
 */
import type { IndexedPolyhedron, Vertex } from "@/io/common";

/**
 * Degrees from vertical past which a downward face usually needs support.
 *
 * The traditional slicer number, and the same one `overhang-relief` in the pattern library
 * is written around.
 */
export const OVERHANG_THRESHOLD_DEG = 45;

/**
 * How close to the lowest point still counts as touching the plate.
 *
 * Well under a 0.2mm layer, so it can never merge two levels a printer would keep apart.
 */
export const CONTACT_EPS_MM = 0.01;

/**
 * Above this, the edge check is skipped rather than run.
 *
 * It sorts an array of three doubles per triangle, so the cost is real and the benefit on a
 * mesh this size is small — anything with a million triangles came from a sweep, not from a
 * surface with a hole in it.
 */
const MAX_TRIANGLES_TO_CHECK = 400_000;

/** Vertex indices are packed two to a double, so they have to fit in 21 bits each. */
const MAX_PACKABLE_VERTICES = 2 ** 21;

export interface Watertightness {
  /** Every edge shared by exactly two faces, wound opposite ways. Nothing else is printable. */
  ok: boolean;
  /** Edges with only one face on them — the surface has holes. */
  openEdges: number;
  /** Edges with three or more faces — the surface passes through itself. */
  nonManifoldEdges: number;
  /** Two faces on an edge wound the same way, which means one of them is inside out. */
  flippedEdges: number;
  /** The signed volume came out negative: the whole surface faces inward. */
  inverted: boolean;
  /** Too many triangles to check. The counts above are all zero and mean nothing. */
  skipped: boolean;
}

export interface Overhang {
  thresholdDeg: number;
  /** Square millimeters of downward face steeper than the threshold, plate contact excluded. */
  area: number;
  /** That area as a share of the whole surface, 0 to 1. */
  fraction: number;
  /** The worst angle from vertical anywhere on the model, 0 to 90. */
  steepestDeg: number;
  /** The height band the steep faces live in, so "where" has an answer. */
  lowZ: number;
  highZ: number;
}

export interface Bed {
  /** Square millimeters of surface lying on the plate. */
  contactArea: number;
  /** The convex support polygon, counter-clockwise, in plate XY. */
  footprint: Array<{ x: number; y: number }>;
  /**
   * Millimeters from the balance point's shadow to the nearest edge of that polygon.
   * Negative means the shadow falls outside it, and the model topples.
   */
  tipMargin: number | null;
  /** Degrees the plate could tilt before it goes over. Null when it's already falling. */
  tipAngleDeg: number | null;
  /** Set when the model balances on a single point or a single line rather than an area. */
  balancesOnAPoint: boolean;
}

export interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface GeometryReport {
  triangles: number;
  size: { x: number; y: number; z: number };
  /** The corners of the box the model sits in, which is what a cut plane is bounded by. */
  bounds: Bounds;
  /** The lowest point, so callers can talk about heights the same way the plate does. */
  lowestZ: number;
  /**
   * Cubic millimeters.
   *
   * Meaningless unless `watertight.ok`: on a surface with a hole this is the volume of an
   * arbitrary cone-completion of that hole, which is a real number about nothing. Callers
   * must gate every display of it, and of anything derived from it, on that flag.
   */
  volume: number;
  /** Square millimeters. Honest even on an open surface — area needs no closure. */
  area: number;
  /** Center of mass at uniform density, in plate coordinates. Null when there's no volume. */
  centroid: { x: number; y: number; z: number } | null;
  watertight: Watertightness;
  overhang: Overhang;
  bed: Bed;
  /** The program compiled and produced no geometry at all. Everything above is zeroed. */
  empty: boolean;
}

const EMPTY_REPORT: GeometryReport = {
  triangles: 0,
  size: { x: 0, y: 0, z: 0 },
  bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
  lowestZ: 0,
  volume: 0,
  area: 0,
  centroid: null,
  watertight: {
    ok: false,
    openEdges: 0,
    nonManifoldEdges: 0,
    flippedEdges: 0,
    inverted: false,
    skipped: false,
  },
  overhang: { thresholdDeg: OVERHANG_THRESHOLD_DEG, area: 0, fraction: 0, steepestDeg: 0, lowZ: 0, highZ: 0 },
  bed: {
    contactArea: 0,
    footprint: [],
    tipMargin: null,
    tipAngleDeg: null,
    balancesOnAPoint: false,
  },
  empty: true,
};

export function inspectMesh(mesh: IndexedPolyhedron): GeometryReport {
  const { vertices, faces } = mesh;
  if (!vertices.length || !faces.length) return { ...EMPTY_REPORT };

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }

  // Volume and centroid sum tetrahedra from an apex, and every term is a product of three
  // coordinates. Putting the apex at the middle of the model instead of at the world origin
  // keeps those terms the size of the model rather than the size of its distance from
  // origin, so a part modeled far from center doesn't lose its volume to cancellation.
  const ox = (minX + maxX) / 2;
  const oy = (minY + maxY) / 2;
  const oz = (minZ + maxZ) / 2;

  const contactCeiling = minZ + CONTACT_EPS_MM;

  let area = 0;
  let sixVolume = 0;
  let cnx = 0, cny = 0, cnz = 0;

  let overhangArea = 0;
  let steepestDeg = 0;
  let overhangLowZ = Infinity;
  let overhangHighZ = -Infinity;
  let contactArea = 0;

  for (const face of faces) {
    const [ia, ib, ic] = face.vertices;
    const a = vertices[ia];
    const b = vertices[ib];
    const c = vertices[ic];
    if (!a || !b || !c) continue;

    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;

    // Length is twice the triangle's area, and direction is the outward normal. Both come
    // out of the one cross product.
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const twiceArea = Math.hypot(nx, ny, nz);

    // A degenerate triangle has no area, no direction, and normalizing it would produce
    // NaN that poisons every sum it touches. It contributes nothing to any of them.
    if (twiceArea === 0) continue;

    const faceArea = twiceArea / 2;
    area += faceArea;

    const ax = a.x - ox, ay = a.y - oy, az = a.z - oz;
    const bx = b.x - ox, by = b.y - oy, bz = b.z - oz;
    const cx = c.x - ox, cy = c.y - oy, cz = c.z - oz;

    // Six times the signed volume of the tetrahedron (apex, a, b, c).
    const det = ax * (by * cz - cy * bz) - ay * (bx * cz - cx * bz) + az * (bx * cy - cx * by);
    sixVolume += det;

    // That tetrahedron's own centroid is the mean of its four corners, and the apex is at
    // the origin of these coordinates, so it is (a + b + c) / 4. Weighting each by its
    // signed volume and dividing by the total at the end gives the solid's center of mass.
    cnx += det * (ax + bx + cx);
    cny += det * (ay + by + cy);
    cnz += det * (az + bz + cz);

    const highestZ = Math.max(a.z, b.z, c.z);
    const lowestFaceZ = Math.min(a.z, b.z, c.z);

    // A face lying flat on the plate is resting on it, not hanging over anything. Without
    // this every model reports that it needs support, because of its own base.
    if (highestZ <= contactCeiling) {
      contactArea += faceArea;
      continue;
    }

    // Slicer convention: measured from vertical, so a wall is 0 and a ceiling is 90.
    const unitNz = nz / twiceArea;
    if (unitNz >= 0) continue;
    const angle = (Math.asin(Math.min(1, -unitNz)) * 180) / Math.PI;
    if (angle > steepestDeg) steepestDeg = angle;
    if (angle > OVERHANG_THRESHOLD_DEG) {
      overhangArea += faceArea;
      if (lowestFaceZ < overhangLowZ) overhangLowZ = lowestFaceZ;
      if (highestZ > overhangHighZ) overhangHighZ = highestZ;
    }
  }

  const volume = Math.abs(sixVolume) / 6;

  let centroid: GeometryReport["centroid"] = null;
  if (Math.abs(sixVolume) > 1e-9) {
    centroid = {
      x: cnx / (4 * sixVolume) + ox,
      y: cny / (4 * sixVolume) + oy,
      z: cnz / (4 * sixVolume) + oz,
    };
  }

  const watertight = checkWatertight(mesh);
  watertight.inverted = sixVolume < 0;
  watertight.ok = watertight.ok && !watertight.inverted;

  const bed = measureBed(vertices, contactCeiling, contactArea, centroid, minZ);

  return {
    triangles: faces.length,
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    bounds: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
    lowestZ: minZ,
    volume,
    area,
    centroid,
    watertight,
    overhang: {
      thresholdDeg: OVERHANG_THRESHOLD_DEG,
      area: overhangArea,
      fraction: area > 0 ? overhangArea / area : 0,
      steepestDeg,
      lowZ: overhangLowZ === Infinity ? 0 : overhangLowZ,
      highZ: overhangHighZ === -Infinity ? 0 : overhangHighZ,
    },
    bed,
    empty: false,
  };
}

/**
 * Whether the surface closes.
 *
 * Every edge of a solid belongs to exactly two triangles, and those two run along it in
 * opposite directions. Anything else is a defect a slicer will either refuse or guess at,
 * and the STL export carries it out silently — which is why this runs at all.
 *
 * One sorted array of packed directed edges rather than a hash: a map of a few hundred
 * thousand entries costs an order of magnitude more memory and is no faster here.
 */
function checkWatertight(mesh: IndexedPolyhedron): Watertightness {
  const blank: Watertightness = {
    ok: false,
    openEdges: 0,
    nonManifoldEdges: 0,
    flippedEdges: 0,
    inverted: false,
    skipped: false,
  };

  if (mesh.faces.length > MAX_TRIANGLES_TO_CHECK || mesh.vertices.length >= MAX_PACKABLE_VERTICES) {
    return { ...blank, skipped: true };
  }

  const byIndex = pairEdges(mesh.faces, null);

  // Pairing by index calls a seam open whenever two triangles meet at coincident points
  // that were never merged into one vertex. OpenSCAD's manifold backend always merges, so
  // this second pass is for meshes from anywhere else — and it only runs when the first
  // answer was bad news, so the common case pays nothing for it.
  if (byIndex.openEdges > 0) {
    return pairEdges(mesh.faces, weldByPosition(mesh.vertices));
  }

  return byIndex;
}

/** Vertex indices merged by position, for a mesh whose coincident corners weren't shared. */
function weldByPosition(vertices: Vertex[]): Int32Array {
  // A ten-thousandth of a millimeter: far finer than anything a printer resolves, and far
  // coarser than the float noise that separates two corners meant to be the same one.
  const quantum = 1e4;
  const canonical = new Map<string, number>();
  const remap = new Int32Array(vertices.length);

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const key = `${Math.round(v.x * quantum)},${Math.round(v.y * quantum)},${Math.round(v.z * quantum)}`;
    const seen = canonical.get(key);
    if (seen === undefined) {
      canonical.set(key, i);
      remap[i] = i;
    } else {
      remap[i] = seen;
    }
  }

  return remap;
}

function pairEdges(faces: IndexedPolyhedron["faces"], remap: Int32Array | null): Watertightness {
  const keys = new Float64Array(faces.length * 3);
  let count = 0;

  for (const face of faces) {
    const a = remap ? remap[face.vertices[0]] : face.vertices[0];
    const b = remap ? remap[face.vertices[1]] : face.vertices[1];
    const c = remap ? remap[face.vertices[2]] : face.vertices[2];
    // A triangle that collapsed to a line or a point after welding has no edges to pair.
    if (a === b || b === c || c === a) continue;
    keys[count++] = packEdge(a, b);
    keys[count++] = packEdge(b, c);
    keys[count++] = packEdge(c, a);
  }

  const packed = keys.subarray(0, count);
  packed.sort();

  let openEdges = 0;
  let nonManifoldEdges = 0;
  let flippedEdges = 0;

  let i = 0;
  while (i < count) {
    const edge = Math.floor(packed[i] / 2);
    let end = i + 1;
    while (end < count && Math.floor(packed[end] / 2) === edge) end++;

    const run = end - i;
    if (run === 1) {
      openEdges++;
    } else if (run === 2) {
      // Two faces on the edge is right; they have to disagree about which way it runs.
      // Agreeing means one of the pair is wound inside out.
      if (packed[i] % 2 === packed[i + 1] % 2) flippedEdges++;
    } else {
      nonManifoldEdges++;
    }

    i = end;
  }

  return {
    ok: openEdges === 0 && nonManifoldEdges === 0 && flippedEdges === 0,
    openEdges,
    nonManifoldEdges,
    flippedEdges,
    inverted: false,
    skipped: false,
  };
}

/**
 * One directed edge as a single exact integer.
 *
 * The pair of vertices, smaller first, identifies the edge; the low bit records which way
 * this face ran along it. So `key >> 1` groups the faces that share an edge and the low bit
 * tells them apart, out of one sort. The largest value is 2^43, well inside the range where
 * a double counts exactly.
 */
function packEdge(i: number, j: number): number {
  const low = i < j ? i : j;
  const high = i < j ? j : i;
  return (low * MAX_PACKABLE_VERTICES + high) * 2 + (i < j ? 0 : 1);
}

/** How the model stands on the plate, and how close it is to not standing. */
function measureBed(
  vertices: Vertex[],
  contactCeiling: number,
  contactArea: number,
  centroid: GeometryReport["centroid"],
  lowestZ: number,
): Bed {
  const touching: Array<{ x: number; y: number }> = [];
  for (const v of vertices) {
    if (v.z <= contactCeiling) touching.push({ x: v.x, y: v.y });
  }

  const footprint = convexHull(touching);

  // Balancing on a point or along a single line. There's no margin to quote — the answer
  // isn't a number of millimeters, it's that this won't stand up on its own.
  if (footprint.length < 3) {
    return {
      contactArea,
      footprint,
      tipMargin: null,
      tipAngleDeg: null,
      balancesOnAPoint: footprint.length > 0,
    };
  }

  if (!centroid) {
    return { contactArea, footprint, tipMargin: null, tipAngleDeg: null, balancesOnAPoint: false };
  }

  let tipMargin = Infinity;
  for (let i = 0; i < footprint.length; i++) {
    const p = footprint[i];
    const q = footprint[(i + 1) % footprint.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const length = Math.hypot(ex, ey);
    if (length === 0) continue;
    // The hull runs counter-clockwise, so inside is to the left of every edge and a left
    // turn is positive. Distance to the nearest edge is how far it can lean before the
    // balance point crosses one.
    const distance = (ex * (centroid.y - p.y) - ey * (centroid.x - p.x)) / length;
    if (distance < tipMargin) tipMargin = distance;
  }

  const height = centroid.z - lowestZ;
  const tipAngleDeg =
    tipMargin > 0 && height > 0 ? (Math.atan(tipMargin / height) * 180) / Math.PI : null;

  return { contactArea, footprint, tipMargin, tipAngleDeg, balancesOnAPoint: false };
}

/**
 * The convex hull of the contact points, counter-clockwise. Andrew's monotone chain.
 *
 * Convex is not an approximation here, it is the physics. A ring doesn't fall over because
 * there's a hole in the middle of it: what holds an object up is the convex polygon its
 * contact points span. Anyone tempted to refine this into the exact contact region would
 * be making it wrong.
 */
function convexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length < 3) return points.slice();

  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);

  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Array<{ x: number; y: number }> = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Array<{ x: number; y: number }> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);

  // Every point was collinear, so there is no polygon — only the segment it spans.
  return hull.length >= 3 ? hull : sorted.slice(0, 2);
}
