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
const { parseParameters, setParameter, stepFor } = await import("../src/lib/scadParameters.ts");
const { stances, betterStance, turnSource, STANCES } = await import("../src/lib/geometry/orientation.ts");
const { checkExpectations, misses, describeMisses, MEASURABLES } = await import(
  "../src/lib/geometry/expectations.ts"
);
const { snapTo } = await import("../src/lib/measure.ts");

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

  check("reach › the radius is the real one, not the box's corner", async () => {
    // A cube's furthest point IS its corner, so the two agree and this pins the maths.
    const cube = await inspect("cube(20);");
    near(cube.boundingRadius, Math.hypot(10, 10, 10), 1e-6, "a cube reaches its corner");

    // A ball's doesn't. Half the box diagonal here is 17.3mm against a real reach of 10 —
    // and a picture framed to the larger number leaves the ball at half the size it should
    // be, which is exactly the bug this measurement exists to stop.
    const ball = await inspect("sphere(r = 10, $fn = 128);");
    near(ball.boundingRadius, 10, 10 * 0.01, "a ball reaches its own radius");
    if (!(ball.boundingRadius < Math.hypot(10, 10, 10) * 0.7)) {
      throw new Error("a ball is being measured as though it were a cube");
    }

    // Turning something must not change how big it is.
    const flat = await inspect("cube([40, 10, 10], center = true);");
    const turned = await inspect("rotate([0, 0, 37]) cube([40, 10, 10], center = true);");
    near(turned.boundingRadius, flat.boundingRadius, 0.01, "reach survives a rotation");
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

/**
 * The dials.
 *
 * Two things have to hold. What's read out of a program has to match what the program
 * actually does — a slider labelled "wall" that doesn't change the wall is worse than no
 * slider. And what's written back has to be the same program with one number different,
 * which is checked by compiling it and measuring the result rather than by comparing text.
 */
const PARAMETERS = [
  check("dials › the controls are read off the top of the program", async () => {
    const program = `/* [Size] */
height = 80;      // How tall it stands [40:200]
diameter = 72;    // [30:150]
wall = 2.5;       // Wall thickness [1:0.1:5]

/* [Extras] */
lid = true;       // Put a lid on it
style = "round";  // [round, square]
ribs = 12;

$fn = 32;
scratch = 5;
cylinder(h = height, r = diameter / 2);`;

    const found = parseParameters(program);
    is(found.map((p) => p.name).join(","), "height,diameter,wall,lid,style,ribs", "names, in order");

    const [height, diameter, wall, lid, style, ribs] = found;
    is(height.label, "How tall it stands", "a stated label wins");
    is(diameter.label, "Diameter", "a missing label is made from the name");
    is(height.group, "Size", "the heading it sits under");
    is(lid.group, "Extras", "the second heading");
    near(wall.step, 0.1, 0, "the step out of a three-part range");
    near(wall.min, 1, 0, "range low");
    near(wall.max, 5, 0, "range high");
    is(lid.kind, "boolean", "true/false is a switch");
    is(style.kind, "option", "a list is a choice");
    is(style.options.map((o) => o.label).join("/"), "round/square", "the choices");
    is(ribs.kind, "number", "a number with no range still gets a control");
    is(ribs.min, undefined, "...but no slider to drag");
  }),

  check("dials › nothing below the program's first real line becomes a control", async () => {
    // `$fn` is a renderer setting, and `scratch` is working-out inside a module. Neither is
    // a dimension of the object, and offering either as a dial would be a lie.
    const found = parseParameters(`size = 10; // [1:20]
$fn = 32;
module thing() { scratch = 4; cube(scratch); }
inner = 99;
thing();`);
    is(found.map((p) => p.name).join(","), "size", "only the one above the program");
  }),

  check("dials › a hidden section is left alone", async () => {
    const found = parseParameters(`shown = 1; // [0:10]
/* [Hidden] */
secret = 2; // [0:10]`);
    is(found.map((p) => p.name).join(","), "shown", "hidden stops the scan");
  }),

  check("dials › turning a dial changes the model and nothing else", async () => {
    const program = `// A cup you can resize.
height = 80;        // [40:200]
diameter = 72;      // [30:150]
wall = 2.5;         // [1:0.1:5]

$fn = 32;
difference() {
  cylinder(h = height, r = diameter / 2);
  translate([0, 0, 5]) cylinder(h = height, r = diameter / 2 - wall);
}`;

    const before = await inspect(program);
    near(before.size.z, 80, 1e-9, "height as written");

    const taller = setParameter(program, "height", 120);
    const after = await inspect(taller);
    near(after.size.z, 120, 1e-9, "height after the dial");
    near(after.size.x, before.size.x, 1e-9, "width untouched");

    // The rest of the file is byte-identical: only the one literal moved.
    is(taller.replace("120", "80"), program, "one number changed, nothing else");

    // A thicker wall is more material in the same outside shape.
    const thicker = await inspect(setParameter(program, "wall", 4.25));
    near(thicker.size.x, before.size.x, 1e-9, "outside unchanged by the wall");
    if (!(thicker.volume > before.volume)) {
      throw new Error(`thicker wall measured ${thicker.volume}, not more than ${before.volume}`);
    }
  }),

  check("dials › a switch flips real geometry", async () => {
    const program = `solid = false;
$fn = 32;
difference() {
  cylinder(h = 40, r = 20);
  if (!solid) translate([0, 0, 5]) cylinder(h = 40, r = 17);
}`;
    const hollow = await inspect(program);
    const filled = await inspect(setParameter(program, "solid", true));
    if (!(filled.volume > hollow.volume * 2)) {
      throw new Error(`solid measured ${filled.volume}, hollow ${hollow.volume}`);
    }
  }),

  check("dials › a count moves in whole numbers, a measurement doesn't", async () => {
    // Straight off a real build: the agent wrote `ring_count = 3; // [0:6]` for the number
    // of grooves in a coaster. Offered in halves, that dial can commit three and a half
    // grooves, which is not a thing a coaster can have.
    const found = parseParameters(`ring_count = 3;   // Grooves in the floor [0:6]
diameter = 95;    // Across the top [60:140]
wall = 2.5;       // Wall thickness [1:5]
ring_depth = 0.8; // How deep they cut [0.3:0.1:2]
span = 400;       // A long way [0:1000]`);
    const step = (name) => stepFor(found.find((p) => p.name === name));
    near(step("ring_count"), 1, 0, "step for a count");
    near(step("diameter"), 1, 0, "step for whole millimetres");
    near(step("wall"), 0.1, 0, "step for a small measurement");
    near(step("ring_depth"), 0.1, 0, "a stated step is always obeyed");
    near(step("span"), 1, 0, "step over a wide whole range");
  }),

  check("dials › a value that isn't one is refused rather than compiled", async () => {
    // The reason this gate exists: OpenSCAD parses these as expressions. A semicolon would
    // be a second statement, and a word would become `undef` and render a wrong shape
    // without ever reporting an error. Both are rejected before they reach the program.
    const program = `height = 80; // [40:200]\nsolid = false;\ncube(height);`;
    for (const bad of ["10; cube(500)", "abc", "1/0", "", "undef"]) {
      is(setParameter(program, "height", bad), program, `refused ${JSON.stringify(bad)}`);
    }
    is(setParameter(program, "height", Number.NaN), program, "refused NaN");
    is(setParameter(program, "height", Infinity), program, "refused Infinity");
    is(setParameter(program, "nosuchdial", 5), program, "refused an unknown dial");

    // And the shape that would have resulted from letting one through.
    const injected = await inspect(`height = 10; cube(500);\ncube(height);`);
    if (!(injected.size.x > 400)) throw new Error("the injection fixture didn't inject");
  }),
];

/**
 * Which way up to print it.
 *
 * The one that has to hold: judging a stance by turning the mesh has to agree with
 * turning the model and compiling it. Where it doesn't, the advisor is reading a shape
 * nobody is going to print.
 */
const ORIENTATION = [
  check("stance › turning the mesh agrees with turning the model", async () => {
    // A mushroom: a flat cap on a thin stem, so its underside is a large, unambiguous
    // overhang that changes completely depending on which way up it goes.
    const program = `$fn = 48;
union() {
  cylinder(h = 40, r = 8);
  translate([0, 0, 40]) cylinder(h = 6, r = 26);
}`;
    const upright = await inspect(program);
    const predicted = stances(parseOff((await render(program, { includeOff: true })).off), upright.area, upright.centroid);

    for (const stance of predicted) {
      const compiled = await inspect(
        `rotate([${stance.turn.join(", ")}]) {\n${program}\n}`,
      );
      const label = `[${stance.turn.join(",")}]`;
      // A reading the module itself calls borderline is one it has already disowned.
      if (stance.borderline) continue;
      near(stance.overhangArea, compiled.overhang.area, relative(Math.max(compiled.overhang.area, 1)) + 0.01, `${label} overhang`);
      near(stance.contactArea, compiled.bed.contactArea, relative(Math.max(compiled.bed.contactArea, 1)) + 0.01, `${label} contact`);
      near(stance.height, compiled.size.z, 1e-6, `${label} height`);
    }
  }),

  check("stance › the advice is to turn the mushroom over", async () => {
    const program = `$fn = 48;
union() {
  cylinder(h = 40, r = 8);
  translate([0, 0, 40]) cylinder(h = 6, r = 26);
}`;
    const upright = await inspect(program);
    const all = stances(parseOff((await render(program, { includeOff: true })).off), upright.area, upright.centroid);
    const advice = betterStance(all);
    if (!advice) throw new Error("nothing suggested for a cap on a stem, which is the easy case");

    // And the advice has to survive being compiled, which is the whole point of confirming.
    const turned = await inspect(turnSource(program, advice.turn));
    if (!(turned.overhang.area < upright.overhang.area * 0.67)) {
      throw new Error(
        `turned it still has ${turned.overhang.area.toFixed(0)}mm² against ${upright.overhang.area.toFixed(0)}mm²`,
      );
    }
    near(turned.volume, upright.volume, relative(upright.volume), "turning it changes nothing but which way it faces");
  }),

  check("stance › a cube is never told to turn", async () => {
    // Every way up is the same way up. Advice here would be noise with a number on it.
    const cube = await inspect("cube(20);");
    const all = stances(parseOff((await render("cube(20);", { includeOff: true })).off), cube.area, cube.centroid);
    is(betterStance(all), null, "advice for a cube");
    for (const stance of all) near(stance.height, 20, 1e-6, `height ${stance.turn.join(",")}`);
  }),

  check("stance › nothing is suggested that would fall over or stand on a point", async () => {
    // A tall spike: lying down removes every overhang, but it is the standing-up case that
    // must never be offered — and neither may anything balanced on a corner.
    const program = "$fn = 32; cylinder(h = 90, r1 = 20, r2 = 2);";
    const base = await inspect(program);
    const all = stances(parseOff((await render(program, { includeOff: true })).off), base.area, base.centroid);
    const advice = betterStance(all);
    if (advice) {
      const turned = await inspect(turnSource(program, advice.turn));
      if (turned.bed.contactArea < 25) throw new Error("suggested a stance that stands on almost nothing");
      if (turned.bed.tipMargin !== null && turned.bed.tipMargin <= 0) {
        throw new Error("suggested a stance that topples");
      }
    }
  }),

  check("stance › the six are the six, and each is a real turn", async () => {
    is(STANCES.length, 6, "how many ways to set it down square");
    const seen = new Set(STANCES.map((s) => s.turn.join(",")));
    is(seen.size, 6, "no two the same");
    is(STANCES[0].turn.join(","), "0,0,0", "the first is the one they already have");
  }),
];

/**
 * The agent held to what it said.
 *
 * A claim is only worth making if it can fail, so most of these are about failing: a size
 * that's wrong has to be caught, and a claim that couldn't have been wrong has to be told
 * apart from one that was checked and passed.
 */
const EXPECTATIONS = [
  check("promises › a size that's right passes and a size that's wrong doesn't", async () => {
    const report = await inspect("cube([40, 30, 20]);");
    const results = checkExpectations(
      [
        { what: "the width", measure: "width", value: 40, tolerance: 0.5 },
        { what: "the depth", measure: "depth", value: 30, tolerance: 0.5 },
        { what: "the height", measure: "height", value: 25, tolerance: 0.5 },
      ],
      report,
    );
    is(results[0].ok, true, "40 against 40");
    is(results[1].ok, true, "30 against 30");
    is(results[2].ok, false, "25 against 20");
    is(misses(results).length, 1, "how many missed");
    near(misses(results)[0].actual, 20, 1e-6, "what it really measures");

    // The repair pass is told which number, what was promised, and what came out.
    const fault = describeMisses(results);
    for (const fragment of ["height", "25", "20"]) {
      if (!fault.includes(fragment)) throw new Error(`the fault doesn't mention ${fragment}`);
    }
  }),

  check("promises › the edge of the tolerance is inside it", async () => {
    const report = await inspect("cube([40, 30, 20]);");
    const at = (value, tolerance) =>
      checkExpectations([{ what: "the width", measure: "width", value, tolerance }], report)[0].ok;
    is(at(40.5, 0.5), true, "exactly at the edge");
    is(at(40.51, 0.5), false, "just past it");
  }),

  check("promises › a claim nothing could fail is not counted as checked", async () => {
    const report = await inspect("cube([40, 30, 20]);");
    const vacuous = checkExpectations(
      [{ what: "the width", measure: "width", value: 40, tolerance: 999 }],
      report,
    )[0];
    is(vacuous.ok, true, "it doesn't fail");
    if (!vacuous.skipped) throw new Error("a tolerance that swallows the value passed as a real check");

    const zero = checkExpectations(
      [{ what: "the width", measure: "width", value: 40, tolerance: 0 }],
      report,
    )[0];
    if (!zero.skipped) throw new Error("a zero tolerance passed as a real check");
  }),

  check("promises › volume isn't judged on a shape that doesn't close", async () => {
    const { off } = await render("cube(20);", { includeOff: true });
    const holed = inspectMesh(parseOff(dropFaces(off, 1)));
    const result = checkExpectations(
      [{ what: "the volume", measure: "volume", value: 8000, tolerance: 10 }],
      holed,
    )[0];
    is(result.ok, true, "not failed");
    is(result.actual, null, "and not measured either");
    if (!result.skipped) throw new Error("it was treated as a real check");
  }),

  check("promises › nothing may be claimed that isn't really measured", async () => {
    // Wall thickness and hole diameter are the two worth checking and neither can be yet.
    // If either appears here without a ray cast behind it, this feature is lying.
    is(MEASURABLES.join(","), "width,depth,height,volume", "what may be claimed");
  }),

  check("promises › an empty list is not a failure", async () => {
    const report = await inspect("cube(10);");
    is(checkExpectations([], report).length, 0, "no claims, no results");
    is(misses(checkExpectations([], report)).length, 0, "and nothing missed");
  }),
];

/**
 * The ruler landing where it was meant to.
 *
 * These run against a real mesh rather than made-up points, because the thing that makes
 * snapping wrong in practice isn't the arithmetic — it's the model sitting somewhere other
 * than where the measurement thinks it is. A cube built from z=0 to z=20 and one built from
 * z=-10 to z=10 have to snap to the same readings.
 */
const SNAPPING = [
  check("snap › a near miss lands on the corner, a far one lands nowhere", async () => {
    const { off } = await render("cube(20);", { includeOff: true });
    const mesh = parseOff(off);
    const report = inspectMesh(mesh);

    // The corner at (20, 20, 20) in plate terms, clicked a fraction off.
    const near1 = snapTo({ x: 19.6, y: 20.3, z: 19.8 }, mesh.vertices, report.lowestZ, 2);
    if (!near1) throw new Error("a click a fraction off a corner found nothing");
    near(near1.x, 20, 1e-6, "snapped x");
    near(near1.y, 20, 1e-6, "snapped y");
    near(near1.z, 20, 1e-6, "snapped z");

    // The middle of a face is nowhere near a corner and must stay where it was put.
    is(snapTo({ x: 10, y: 10, z: 20 }, mesh.vertices, report.lowestZ, 2), null, "middle of a face");
  }),

  check("snap › the model being modelled below the plate changes nothing", async () => {
    // exportGlb drops the model so its underside sits at z=0, and a reading is taken in
    // those terms while the mesh is still in its own. Get that wrong and every snap on a
    // model built around the origin is off by half its height.
    const { off } = await render("cube(20, center = true);", { includeOff: true });
    const mesh = parseOff(off);
    const report = inspectMesh(mesh);
    near(report.lowestZ, -10, 1e-6, "this one really is below the plate");

    // Its top corner reads as z = 20 on the plate, not z = 10 as the mesh has it.
    const snapped = snapTo({ x: 9.7, y: 10.2, z: 19.6 }, mesh.vertices, report.lowestZ, 2);
    if (!snapped) throw new Error("nothing found at the top corner");
    near(snapped.z, 20, 1e-6, "snapped to the plate reading, not the mesh one");
    near(snapped.x, 10, 1e-6, "snapped x");
  }),

  check("snap › it takes the nearest corner, not the first one it passes", async () => {
    const { off } = await render("cube(20);", { includeOff: true });
    const mesh = parseOff(off);
    const report = inspectMesh(mesh);
    // Nearer to (20,0,0) than to (0,0,0), with both inside a generous tolerance.
    const snapped = snapTo({ x: 13, y: 0.4, z: 0.4 }, mesh.vertices, report.lowestZ, 40);
    near(snapped.x, 20, 1e-6, "the nearer corner");
  }),

  check("snap › a measurement between two snapped corners is the real size", async () => {
    // The point of all of it: corner to corner across a 20mm cube is 20mm, not 19.7.
    const { off } = await render("cube([20, 35, 12]);", { includeOff: true });
    const mesh = parseOff(off);
    const report = inspectMesh(mesh);
    const a = snapTo({ x: 0.3, y: 0.2, z: 0.4 }, mesh.vertices, report.lowestZ, 2);
    const b = snapTo({ x: 19.8, y: 0.3, z: 0.2 }, mesh.vertices, report.lowestZ, 2);
    near(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), 20, 1e-6, "corner to corner");
  }),

  check("snap › nothing to snap to, or no tolerance, snaps nothing", async () => {
    const { off } = await render("cube(20);", { includeOff: true });
    const mesh = parseOff(off);
    is(snapTo({ x: 0, y: 0, z: 0 }, [], 0, 5), null, "no vertices");
    is(snapTo({ x: 0, y: 0, z: 0 }, mesh.vertices, 0, 0), null, "no tolerance");
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

for (const item of [...CHECKS, ...DEFECTS, ...SECTIONS, ...PARAMETERS, ...ORIENTATION, ...EXPECTATIONS, ...SNAPPING]) {
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
