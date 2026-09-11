/**
 * Grades the geometry inspector against solids whose answers are known exactly.
 *
 * The measurements this produces are shown to the person and handed to the design agent,
 * and an agent told the wrong size builds confidently on top of it. So every number here is
 * checked against a closed form rather than against a previous run: a 20mm cube is 8000mm³,
 * a hexagonal prism is (3√3/2)r²h, and anything else means this module is wrong.
 *
 * Fixtures are rendered in the same WebAssembly OpenSCAD the browser uses and parsed by the
 * same `parseOff` the browser uses, so what's graded is the shipping path and not a copy of
 * it. Low $fn is deliberate — a hexagonal prism is an exact polyhedron, a smooth cylinder
 * is only an approximation of one, and exact answers make far better tests.
 *
 *   npm run verify:geometry           everything
 *   npm run verify:geometry cube      just the checks whose name matches
 */
import { render } from "./lib/scad-render.mjs";

const { parseOff } = await import("../src/io/import_off.ts");
const { inspectMesh } = await import("../src/lib/geometry/inspect.ts");
const { estimateMaterial } = await import("../src/lib/geometry/materials.ts");
const { sectionSource, sectionRange, defaultPosition, startingAxis } = await import(
  "../src/lib/geometry/section.ts"
);

const filter = process.argv[2];

let passed = 0;
const failures = [];

/** Exact volume of a regular hexagonal prism, which is what $fn=6 makes of a cylinder. */
const hexPrism = (r, h) => ((3 * Math.sqrt(3)) / 2) * r * r * h;

/**
 * How far a measurement may drift when the shape's corners aren't round numbers.
 *
 * OpenSCAD writes OFF coordinates to six significant figures, so a corner at 4.330127 is
 * stored as 4.33013 and the volume computed from it is a few parts per million out. That
 * is the format's precision, not this module's error, so fixtures with irrational corners
 * are graded against it. A cube's corners are exact and get no such allowance.
 */
const TEXT_PRECISION = 1e-5;
const relative = (expected) => Math.abs(expected) * TEXT_PRECISION;

function check(name, fn) {
  if (filter && !name.includes(filter)) return;
  return { name, fn };
}

/** Measures a program the way the browser does: render, parse, inspect. */
async function inspect(source) {
  const result = await render(source, { includeOff: true });
  if (result.error) throw new Error(result.error);
  return inspectMesh(parseOff(result.off));
}

const near = (actual, expected, tolerance, what) => {
  if (!Number.isFinite(actual)) throw new Error(`${what} is ${actual}, not a number`);
  const drift = Math.abs(actual - expected);
  if (drift > tolerance) {
    throw new Error(`${what} is ${actual.toFixed(4)}, expected ${expected.toFixed(4)} (off by ${drift.toFixed(4)})`);
  }
};

const is = (actual, expected, what) => {
  if (actual !== expected) throw new Error(`${what} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

const CHECKS = [
  check("cube › every measurement at once", async () => {
    const r = await inspect("cube(20);");
    near(r.volume, 8000, 1e-6, "volume");
    near(r.area, 2400, 1e-6, "surface area");
    near(r.centroid.x, 10, 1e-9, "centroid x");
    near(r.centroid.y, 10, 1e-9, "centroid y");
    near(r.centroid.z, 10, 1e-9, "centroid z");
    near(r.bed.contactArea, 400, 1e-6, "contact area");
    near(r.bed.tipMargin, 10, 1e-9, "tip margin");
    near(r.bed.tipAngleDeg, 45, 1e-9, "tip angle");
    near(r.overhang.area, 0, 1e-9, "overhang area");
    is(r.watertight.ok, true, "watertight");
    is(r.watertight.inverted, false, "inverted");
    is(r.empty, false, "empty");
  }),

  check("cube › centered, to pin the centering of the sums", async () => {
    const r = await inspect("cube([20,20,20], center=true);");
    near(r.volume, 8000, 1e-6, "volume");
    near(r.centroid.x, 0, 1e-9, "centroid x");
    near(r.centroid.y, 0, 1e-9, "centroid y");
    near(r.centroid.z, 0, 1e-9, "centroid z");
  }),

  check("cube › volume survives being modeled far from the origin", async () => {
    const r = await inspect("translate([5000, -4000, 3000]) cube(20);");
    near(r.volume, 8000, 1e-6, "volume");
    near(r.centroid.x, 5010, 1e-6, "centroid x");
  }),

  check("prism › hexagonal prism against its closed form", async () => {
    const r = await inspect("$fn=6; cylinder(h=30, r=5);");
    near(r.volume, hexPrism(5, 30), relative(hexPrism(5, 30)), "volume");
    is(r.watertight.ok, true, "watertight");
  }),

  check("prism › a hole removes exactly its own volume", async () => {
    const r = await inspect(
      "$fn=6; difference() { cube(20); translate([10,10,-1]) cylinder(h=22, r=4); }",
    );
    near(r.volume, 8000 - hexPrism(4, 20), relative(8000), "volume");
    is(r.watertight.ok, true, "watertight");
  }),

  check("overhang › a 45° face sits exactly on the threshold", async () => {
    // The sloped face is at 45° from vertical. The test is strictly greater than the
    // threshold, so this face must NOT be counted — that is what pins the inequality.
    const r = await inspect("rotate([0,0,0]) linear_extrude(10) polygon([[0,0],[20,0],[0,20]]);");
    near(r.overhang.area, 0, 1e-9, "overhang area");
  }),

  check("overhang › a flat ceiling is 90° and is counted", async () => {
    const r = await inspect(
      "$fn=6; union() { cylinder(h=10, r=3); translate([0,0,10]) cylinder(h=5, r=10); }",
    );
    near(r.overhang.steepestDeg, 90, 1e-9, "steepest angle");
    // The underside of the cap, minus where the post holds it up.
    const annulus = hexPrism(10, 1) / 1 - hexPrism(3, 1) / 1;
    near(r.overhang.area, annulus, relative(annulus), "overhang area");
    near(r.overhang.lowZ, 10, 1e-9, "overhang band bottom");
  }),

  check("overhang › the model's own base is never counted as an overhang", async () => {
    // Every downward face here is on the plate. Without the contact exclusion this would
    // report the full footprint as needing support, which is the failure that would make
    // the whole metric worthless.
    const r = await inspect("cube([40, 40, 5]);");
    near(r.overhang.area, 0, 1e-9, "overhang area");
    near(r.bed.contactArea, 1600, 1e-6, "contact area");
  }),

  check("tipping › a cantilever puts the balance point outside its footprint", async () => {
    // A 10x10x40 post with a 40x10x10 arm stuck out at the top. The arm's mass is well
    // outside the post's base, so this falls over.
    const r = await inspect(
      "union() { cube([10,10,40]); translate([10,0,30]) cube([40,10,10]); }",
    );
    // Two boxes: 4000mm³ centered at x=5, 4000mm³ centered at x=30.
    near(r.volume, 8000, 1e-6, "volume");
    near(r.centroid.x, 17.5, 1e-6, "centroid x");
    if (!(r.bed.tipMargin < 0)) {
      throw new Error(`tip margin is ${r.bed.tipMargin}, expected negative — it should fall over`);
    }
    is(r.bed.tipAngleDeg, null, "tip angle when already falling");
    near(r.bed.contactArea, 100, 1e-6, "contact area");
  }),

  check("tipping › a ring is held up by the polygon its feet span, not by its material", async () => {
    // A tube touches the plate only on a thin annulus, but it doesn't topple: what holds
    // an object up is the convex hull of its contact points. If this ever reports a tip
    // risk, someone has "improved" the hull into an exact contact region.
    const r = await inspect("$fn=32; difference() { cylinder(h=10, r=20); translate([0,0,-1]) cylinder(h=12, r=18); }");
    if (!(r.bed.tipMargin > 15)) {
      throw new Error(`tip margin is ${r.bed.tipMargin}, expected the full hull radius`);
    }
  }),

  check("sphere › an inscribed polyhedron comes in under the true volume", async () => {
    // A faceted sphere is inside the smooth one, so it must measure less — never more.
    // Asserting the direction catches a flipped winding or a sign error that a symmetric
    // tolerance would wave through.
    const r = await inspect("sphere(r=10, $fn=128);");
    const trueVolume = (4 / 3) * Math.PI * 1000;
    if (!(r.volume < trueVolume)) {
      throw new Error(`volume is ${r.volume.toFixed(2)}, which is not under the true ${trueVolume.toFixed(2)}`);
    }
    near(r.volume, trueVolume, trueVolume * 0.01, "volume");
  }),

  check("empty › an empty mesh measures as nothing rather than as NaN", async () => {
    // Worth stating plainly, because it is not what it looks like: a program that builds
    // nothing does NOT reach here. OpenSCAD writes no output file at all for an empty
    // result, so the renderer reports it as an error and no mesh is ever parsed. This
    // guards the parse path itself -- an empty mesh from anywhere must measure as zero
    // and never as NaN, because NaN would travel all the way to the agent.
    const r = inspectMesh(parseOff("OFF 0 0 0"));
    is(r.empty, true, "empty");
    near(r.volume, 0, 0, "volume");
    is(r.centroid, null, "centroid");
    is(r.bed.tipMargin, null, "tip margin");
    for (const [key, value] of Object.entries(r.size)) {
      if (!Number.isFinite(value)) throw new Error(`size.${key} is ${value}`);
    }
  }),

  check("empty › the two-line OFF header is read, not turned into NaN", async () => {
    const mesh = parseOff("OFF\n8 6 0\n" + "0 0 0\n".repeat(8) + "3 0 0 0\n".repeat(6));
    is(mesh.vertices.length, 8, "vertices parsed");
  }),

  check("material › a 20mm cube in PLA", async () => {
    const { grams, filamentMm } = estimateMaterial(8000);
    near(grams, 9.92, 0.005, "grams");
    near(filamentMm, 3325.6, 1, "filament length");
  }),
];

/**
 * Surface defects, built by editing a known-good mesh.
 *
 * These can't be produced by OpenSCAD — the manifold backend always emits a closed solid —
 * so the only way to exercise the check that catches them is to break a good mesh by hand.
 * Which makes this the only test of the code path that stops a broken STL from downloading.
 */
const DEFECTS = [
  check("defects › a hole in the surface is reported as open edges", async () => {
    const { off } = await render("cube(20);", { includeOff: true });
    // One removed quad leaves its four shared edges with a face on one side only. Its own
    // diagonal goes with it, so it isn't left dangling.
    const r = inspectMesh(parseOff(dropFaces(off, 1)));
    is(r.watertight.ok, false, "watertight");
    is(r.watertight.openEdges, 4, "open edges");
  }),

  check("defects › a triangle wound backwards is reported as flipped", async () => {
    const { off } = await render("cube(20);", { includeOff: true });
    const r = inspectMesh(parseOff(reverseFirstFace(off)));
    is(r.watertight.ok, false, "watertight");
    // Its four shared edges now run the same way as their neighbours do. The diagonal it
    // shares with its own other half still disagrees correctly, so it isn't counted.
    is(r.watertight.flippedEdges, 4, "flipped edges");
    is(r.watertight.openEdges, 0, "open edges");
  }),

  check("defects › a duplicated triangle is reported as non-manifold", async () => {
    const { off } = await render("cube(20);", { includeOff: true });
    const r = inspectMesh(parseOff(duplicateFirstFace(off)));
    is(r.watertight.ok, false, "watertight");
    // Four shared edges gain a third face, and the diagonal inside the doubled quad gains
    // a third and a fourth.
    is(r.watertight.nonManifoldEdges, 5, "non-manifold edges");
  }),

  check("defects › a mesh turned inside out is caught even though it closes", async () => {
    const { off } = await render("cube(20);", { includeOff: true });
    const r = inspectMesh(parseOff(reverseEveryFace(off)));
    is(r.watertight.inverted, true, "inverted");
    is(r.watertight.ok, false, "watertight");
    near(r.volume, 8000, 1e-6, "volume magnitude");
  }),
];

/**
 * The section view.
 *
 * Everything rests on one claim: wrapping a whole program in a module changes nothing about
 * what it renders. If that ever stops being true, every cut in the app is quietly wrong.
 */
const SECTIONS = [
  check("section › wrapping a program changes nothing about what it builds", async () => {
    // Deliberately awkward: a top-level special variable, top-level assignments, a
    // function, a nested module, and a top-level difference().
    const program = `$fn = 32;
wall = 2;
function rim(r) = r + wall;
module post(r) { cylinder(h = 20, r = r); }
difference() {
  cylinder(h = 20, r = rim(10));
  translate([0, 0, -1]) cylinder(h = 22, r = 10);
}
translate([0, 0, 20]) post(3);`;

    const plain = await inspect(program);
    const bounds = plain.bounds;
    // A cut placed past the far face removes nothing, so this is the wrap on its own.
    const uncut = await inspect(
      sectionSource(program, { axis: "x", position: bounds.max.x + 1 }, bounds),
    );
    near(uncut.volume, plain.volume, 1e-9, "volume through the wrapper");
    near(uncut.area, plain.area, 1e-9, "area through the wrapper");
  }),

  check("section › cutting a symmetric model in half takes exactly half", async () => {
    const program = "$fn = 32; difference() { cylinder(h=20, r=12); translate([0,0,-1]) cylinder(h=22, r=10); }";
    const plain = await inspect(program);
    const cut = await inspect(sectionSource(program, { axis: "x", position: 0 }, plain.bounds));
    near(cut.volume, plain.volume / 2, 1e-6, "half the volume");
  }),

  check("section › a cut low down leaves the part below it", async () => {
    const program = "$fn = 32; difference() { cylinder(h=20, r=12); translate([0,0,-1]) cylinder(h=22, r=10); }";
    const plain = await inspect(program);
    const cut = await inspect(sectionSource(program, { axis: "z", position: 5 }, plain.bounds));
    near(cut.volume, plain.volume / 4, 1e-6, "a quarter of the volume");
    near(cut.size.z, 5, 1e-6, "height of what's left");
  }),

  check("section › a fresh cut runs down through the model, never across it", async () => {
    // Cutting on Z takes the top off, which answers nothing about a wall. A tall narrow
    // object is exactly the case that tempts a longest-axis rule into getting this wrong.
    const tall = await inspect("$fn=32; difference(){ cylinder(h=80,r=20); translate([0,0,5]) cylinder(h=80,r=17); }");
    is(startingAxis(tall.bounds), "x", "axis for a tall cup");

    // And between the two vertical options it takes the wider face.
    const wide = await inspect("cube([80, 20, 10]);");
    is(startingAxis(wide.bounds), "x", "axis for a model wider in x");
    const deep = await inspect("cube([20, 80, 10]);");
    is(startingAxis(deep.bounds), "y", "axis for a model deeper in y");

    // The first cut has to leave something on screen, whatever the shape.
    const cut = await inspect(
      sectionSource(
        "$fn=32; difference(){ cylinder(h=80,r=20); translate([0,0,5]) cylinder(h=80,r=17); }",
        { axis: startingAxis(tall.bounds), position: defaultPosition(tall.bounds, startingAxis(tall.bounds)) },
        tall.bounds,
      ),
    );
    near(cut.volume, tall.volume / 2, relative(tall.volume), "half the cup");
  }),

  check("section › the slider can never be dragged to an empty cut", async () => {
    const program = "cube(20);";
    const plain = await inspect(program);
    for (const axis of ["x", "y", "z"]) {
      const { min, max } = sectionRange(plain.bounds, axis);
      for (const position of [min, defaultPosition(plain.bounds, axis), max]) {
        const cut = await inspect(sectionSource(program, { axis, position }, plain.bounds));
        if (cut.empty || cut.volume <= 0) {
          throw new Error(`cutting ${axis} at ${position} left nothing to look at`);
        }
      }
    }
  }),
];

function offLines(off) {
  const lines = off.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const header = /^OFF\s+\S/.test(lines[0]) ? 0 : 1;
  const counts = (header === 0 ? lines[0].slice(3) : lines[1]).trim().split(/\s+/).map(Number);
  return { lines, start: header + 1, vertexCount: counts[0], faceCount: counts[1] };
}

function rebuild({ lines, start, vertexCount }, faces) {
  const vertices = lines.slice(start, start + vertexCount);
  return [`OFF ${vertexCount} ${faces.length} 0`, ...vertices, ...faces].join("\n");
}

function facesOf(off) {
  const parsed = offLines(off);
  return { parsed, faces: parsed.lines.slice(parsed.start + parsed.vertexCount) };
}

/** Removes faces, leaving a hole in the surface. */
function dropFaces(off, count) {
  const { parsed, faces } = facesOf(off);
  return rebuild(parsed, faces.slice(count));
}

function flip(line) {
  const parts = line.split(/\s+/);
  const n = Number(parts[0]);
  const indices = parts.slice(1, 1 + n).reverse();
  return [parts[0], ...indices, ...parts.slice(1 + n)].join(" ");
}

function reverseFirstFace(off) {
  const { parsed, faces } = facesOf(off);
  return rebuild(parsed, [flip(faces[0]), ...faces.slice(1)]);
}

function reverseEveryFace(off) {
  const { parsed, faces } = facesOf(off);
  return rebuild(parsed, faces.map(flip));
}

function duplicateFirstFace(off) {
  const { parsed, faces } = facesOf(off);
  return rebuild(parsed, [faces[0], ...faces]);
}

for (const item of [...CHECKS, ...DEFECTS, ...SECTIONS]) {
  if (!item) continue;
  const started = Date.now();
  try {
    await item.fn();
    console.log(`  ok  ${item.name}  ${Date.now() - started}ms`);
    passed++;
  } catch (error) {
    failures.push({ name: item.name, reason: error.message });
  }
}

console.log();
if (failures.length) {
  console.log(`${failures.length} check${failures.length === 1 ? "" : "s"} failed:\n`);
  for (const failure of failures) {
    console.log(`  FAIL  ${failure.name}`);
    console.log(`        ${failure.reason}\n`);
  }
  console.log(`${passed} passed, ${failures.length} failed.`);
  process.exit(1);
}

console.log(`${passed} geometry check${passed === 1 ? "" : "s"} passed.`);
