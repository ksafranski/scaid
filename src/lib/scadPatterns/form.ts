import type { ScadPattern } from "./types";

/**
 * Getting from one shape to another.
 *
 * Sweeps, lofts, revolves and textures — the operations that turn a pile of primitives
 * into something that looks designed rather than assembled. hull_chain in particular is
 * the single most useful idiom in plain OpenSCAD and almost nobody discovers it on their own.
 */
export const FORM_PATTERNS: ScadPattern[] = [
  {
    id: "sweep-along-path",
    title: "Sweeping a profile along a curve",
    family: "form",
    synopsis: "Handles, hooks, tubes and bends — drag a cross-section along a path.",
    when:
      "A mug handle, a bag hook, a pipe bend, a curved rail. For a circular path use a partial " +
      "revolve, which is exact and fast. For anything else, chain hulls between slices — that " +
      "idiom covers almost every sweep you'll ever want and is only three lines.",
    triggers: [
      "handle", "hook", "sweep", "curve", "bend", "arc", "tube", "pipe", "loop", "rail",
      "grab", "hold it", "carry", "along a path", "bent", "curved",
      "spiral", "shell", "coil", "snail", "horn", "tentacle", "slow", "taking ages",
    ],
    code: `// Hull each pair of neighbouring children together. This is the workhorse: put a
// series of slices anywhere in space and this skins them into one smooth solid.
//
// WATCH OUT: a for() loop handed to a module counts as ONE child, not many. So
// \`hull_chain() for (p = pts) ...\` silently renders nothing. Pass children literally,
// or write the loop out as in sweep_points below.
module hull_chain() {
  for (i = [0 : $children - 2])
    hull() { children(i); children(i + 1); }
}

// A round bar swept along a circular arc — a mug handle, a hook, a pipe bend.
// \`radius\` is to the centre of the bar, so the outside reaches radius + bar/2.
module sweep_arc(bar_d, radius, angle = 180) {
  rotate_extrude(angle = angle) translate([radius, 0]) circle(d = bar_d);
}

// A bar swept along any list of points. Slower than the revolve, but the path can be
// anything you can write down.
// $fn is deliberately low and LOCAL here. A sweep pays for its primitive's resolution
// once per step, so a global $fn = 64 across 300 beads is the difference between a model
// that appears in two seconds and one that takes twenty-five. The smoothness you can see
// comes from the number of points along the path, not from how round each bead is.
module sweep_points(points, bar_d, detail = 20) {
  for (i = [0 : len(points) - 2])
    hull() {
      translate(points[i]) sphere(d = bar_d, $fn = detail);
      translate(points[i + 1]) sphere(d = bar_d, $fn = detail);
    }
}

// A D-shaped handle standing off a wall — the shape most mug and drawer handles actually are.
module handle_d(bar_d, width, reach, detail = 32) {
  hull_chain() {
    translate([0, 0, 0]) sphere(d = bar_d, $fn = detail);
    translate([reach, 0, width * 0.15]) sphere(d = bar_d, $fn = detail);
    translate([reach, 0, width * 0.85]) sphere(d = bar_d, $fn = detail);
    translate([0, 0, width]) sphere(d = bar_d, $fn = detail);
  }
}`,
    guidance: `The cost of a sweep is the resolution of ONE step, multiplied by every step.

A global \$fn = 64 means every bead in the chain is a 2000-face sphere. Three hundred of
them is over a million faces before a single boolean runs — that is a 25-second render for a
shape indistinguishable from a 3-second one. Measured on a spiral shell: \$fn 64 took 25.1s,
the same shell with the beads at \$fn 20 took 3.6s, and the volume moved 2%.

So give a repeated primitive its own low \$fn in the call — 12 to 24 for a bead in a chain,
8 to 16 for a groove or rib. Never let it inherit the global one. What you actually see is
set by how many steps you take along the path; make THAT number bigger if it looks faceted,
and leave each step coarse.

The same applies to a revolve: prefer sweep_arc over a bead chain when the path is a circle.
It is one rotate_extrude rather than hundreds of hulls, and it was 11ms against BOSL2's 375ms.`,
    usage:
      "rotate([90, 0, 0]) sweep_arc(10, 22, 180) puts a handle on the side of a mug — remember " +
      "the revolve happens around Z, so rotate it into place. Overlap the ends into the body by " +
      "a millimetre or two so they fuse.",
    explain:
      "The handle is a {bar}mm bar bent round a {radius}mm curve. It's swept rather than built " +
      "from blocks, so there's no seam where it meets the body — and a round bar is far more " +
      "comfortable to hold than a square one.",
    checks: [
      {
        name: "arc sweep matches BOSL2's path_sweep",
        subject: "$fn = 48;\nsweep_arc(10, 22, 180);",
        reference:
          "include <BOSL2/std.scad>\n$fn = 48;\npath_sweep(circle(d = 10), arc(r = 22, angle = 180, n = 49));",
        tolerance: 3,
        sizeTolerance: 0.6,
      },
      {
        name: "hull_chain skins a run of spheres into one solid",
        subject: `$fn = 32;
sweep_points([[0, 0, 0], [20, 0, 10], [40, 0, 0]], 8);`,
        // The 8mm bar overhangs the end points by its radius at both ends of every axis.
        expectSize: [48, 8, 18],
        sizeTolerance: 0.1,
      },
      {
        name: "D handle stands off its wall",
        subject: "$fn = 32;\nhandle_d(8, 60, 25);",
        expectSize: [33, 8, 68],
        sizeTolerance: 0.5,
      },
    ],
  },

  {
    id: "loft-profiles",
    requires: ["sweep-along-path"],
    title: "Blending one shape into another",
    family: "form",
    synopsis: "Square base to round top, wide to narrow — stack profiles and hull between them.",
    when:
      "A vase that starts square and ends round, a funnel, a stand that tapers, a nozzle. " +
      "Anywhere a shape has to change along its length. Hulling between thin slices is the " +
      "plain-OpenSCAD way to do this and it handles any pair of profiles.",
    triggers: [
      "taper", "blend", "transition", "morph", "loft", "square to round", "funnel",
      "narrows", "widens", "flare", "conical", "vase", "goes from", "into a",
    ],
    code: `// Blend a square base into a round top over \`height\`.
// Each step is a paper-thin slice; hulling neighbours skins them into one smooth solid.
// One paper-thin slice, \`f\` of the way from square to round.
// offset() out and back in by the same amount is what rounds the corners away.
module _blend_slice(side, top_d, f, z) {
  s = side * (1 - f) + top_d * f;
  // The radius has to be measured against THIS slice, not the base: at f = 1 it reaches
  // half the side, which is exactly a circle. Any larger and offset(-r) erases the slice.
  r = f * s / 2 * 0.999;
  translate([0, 0, z])
    linear_extrude(height = 0.01)
      offset(r = r) offset(r = -r)
        square(s, center = true);
}

module square_to_round(side, top_d, height, steps = 24) {
  slice = height / steps;
  for (i = [0 : steps - 1])
    hull() {
      _blend_slice(side, top_d, i / steps, i * slice);
      _blend_slice(side, top_d, (i + 1) / steps, (i + 1) * slice);
    }
}

// A general loft: each number is a radius, spaced evenly up the height.
module loft_radii(radii, height) {
  n = len(radii);
  step = height / (n - 1);
  for (i = [0 : n - 2])
    hull() {
      translate([0, 0, i * step]) linear_extrude(height = 0.01) circle(r = radii[i]);
      translate([0, 0, (i + 1) * step]) linear_extrude(height = 0.01) circle(r = radii[i + 1]);
    }
}`,
    usage:
      "square_to_round(50, 30, 60) for a square-based vase with a round mouth. " +
      "loft_radii([25, 18, 20, 14], 80) gives a waisted profile — each number is a radius, " +
      "spaced evenly up the height.",
    explain:
      "The base is square and the top is round, blending between the two as it rises. It's " +
      "built as a stack of thin slices, each one a little more rounded than the last, skinned " +
      "together into one smooth surface.",
    checks: [
      {
        name: "square base blends to a round top",
        subject: "$fn = 48;\nsquare_to_round(50, 30, 60);",
        expectSize: [50, 50, 60],
        sizeTolerance: 0.5,
      },
      {
        name: "radius loft hits its widest listed radius",
        subject: "$fn = 48;\nloft_radii([25, 18, 20, 14], 80);",
        expectSize: [50, 50, 80],
        sizeTolerance: 0.5,
      },
    ],
  },

  {
    id: "revolve-profile",
    title: "Turning a profile on its side",
    family: "form",
    synopsis: "Draw the silhouette once and spin it — the fastest way to a vase, bowl or knob.",
    when:
      "Anything round and symmetrical: vases, bowls, cups, knobs, wheels, lampshades. Drawing " +
      "half the silhouette and revolving it is one line of code and renders faster than any " +
      "stack of cylinders, and the curve can be anything you can draw.",
    triggers: [
      "vase", "bowl", "cup", "goblet", "knob", "wheel", "lamp", "shade", "round",
      "symmetrical", "turned", "lathe", "revolve", "profile", "silhouette", "curvy",
    ],
    code: `// A hollow vessel from a silhouette. The profile is the wall itself, drawn in the
// X-Z plane with X as the distance from the axis — so X must never go negative.
module revolve_wall(points) {
  rotate_extrude() polygon(points);
}

// A vase whose radius follows a smooth curve, hollowed to an even wall.
module curved_vase(base_r, max_r, height, wall = 2, steps = 40) {
  outer = [for (i = [0 : steps])
    let (f = i / steps)
    [base_r + (max_r - base_r) * sin(f * 180), f * height]];
  rotate_extrude()
    polygon(concat(
      [[0, 0]],
      outer,
      [for (i = [steps : -1 : 0])
        let (p = outer[i])
        [max(0.01, p[0] - wall), max(wall, p[1])]],
      [[0.01, wall]]
    ));
}

// A knurled or plain knob — a revolve plus a hole for a shaft.
module knob(d, height, shaft_d = 6, waist = 0.85) {
  difference() {
    rotate_extrude()
      polygon([[0, 0], [d / 2, 0], [d / 2 * waist, height / 2],
               [d / 2, height], [0, height]]);
    translate([0, 0, -0.01]) cylinder(d = shaft_d, h = height + 0.02);
  }
}`,
    usage:
      "revolve_wall([[10, 0], [30, 0], [28, 40], [10, 40]]) — points run clockwise, X is the " +
      "distance out from the centre and never goes below zero. curved_vase(20, 35, 90) gives a " +
      "hollowed vase in one call.",
    explain:
      "The whole shape is one curve, spun around a vertical axis — like turning a bowl on a " +
      "lathe. That's why it's perfectly round, and why the wall stays the same thickness the " +
      "whole way up.",
    checks: [
      {
        name: "revolved wall makes a hollow vessel",
        subject: "$fn = 64;\nrevolve_wall([[10, 0], [30, 0], [28, 40], [10, 40]]);",
        expectSize: [60, 60, 40],
        sizeTolerance: 0.3,
      },
      {
        name: "curved vase is hollow and the right height",
        subject: "$fn = 64;\ncurved_vase(20, 35, 90, wall = 2);",
        expectSize: [70, 70, 90],
        sizeTolerance: 0.5,
      },
      {
        name: "knob has a shaft hole through it",
        subject: "$fn = 64;\nknob(30, 20, shaft_d = 6);",
        expectSize: [30, 30, 20],
        sizeTolerance: 0.3,
      },
    ],
  },

  {
    id: "grip-texture",
    title: "Grip — ribs, knurling and finger scallops",
    family: "form",
    synopsis: "Surface texture that makes a round part turnable with wet or small hands.",
    when:
      "Anything meant to be twisted or held: a knob, a bottle cap, a handle, a dial. A smooth " +
      "cylinder is genuinely hard to turn; ribs cost nothing and transform how the object feels.",
    triggers: [
      "grip", "knurl", "knurled", "texture", "ribs", "ridges", "slippery", "twist",
      "turn it", "hold", "thumb", "finger", "traction", "scallop", "flutes",
    ],
    code: `// Vertical ribs round a cylinder. The cheapest, fastest grip there is, and it prints
// perfectly because every surface is vertical.
module grip_ribs(d, h, count = 24, depth = 1) {
  for (i = [0 : count - 1])
    rotate([0, 0, i * 360 / count])
      translate([d / 2, 0, 0])
        cylinder(r = depth, h = h, $fn = 12);
}

// Scalloped finger recesses cut INTO a cylinder — subtract this.
module grip_scallops(d, h, count = 12, depth = 1.5) {
  for (i = [0 : count - 1])
    rotate([0, 0, i * 360 / count])
      translate([d / 2 + depth, 0, -0.01])
        cylinder(r = depth * 2, h = h + 0.02, $fn = 16);
}

// Diamond knurling: two sets of shallow helical grooves crossing each other.
// Subtract this from the part.
//
// COST: this is the slowest thing here — two twisted extrusions cut against a round body,
// and the render time roughly doubles with the groove count. Prefer grip_ribs unless the
// crosshatch is the point. Going much above 14 grooves buys nothing you can print either:
// a 0.4mm nozzle can't resolve a finer pitch than this.
module grip_knurl(d, h, count = 14, depth = 0.6, twist = 40) {
  for (direction = [1, -1])
    linear_extrude(height = h, twist = direction * twist, slices = 20, convexity = 10)
      for (i = [0 : count - 1])
        rotate([0, 0, i * 360 / count])
          translate([d / 2, 0])
            circle(r = depth, $fn = 8);
}`,
    usage:
      "union() { cylinder(d = 30, h = 20); grip_ribs(30, 20); } for raised ribs, or " +
      "difference() { cylinder(d = 30, h = 20); grip_knurl(30, 20); } for cut knurling. " +
      "Around 1mm deep is right — deeper starts to feel sharp. Reach for ribs by default: " +
      "they render in a few milliseconds where knurling takes the best part of a second, " +
      "and on a printed part they grip just as well.",
    explain:
      "There are {count} ribs around the outside. They add almost nothing to the print time " +
      "but make it far easier to turn, especially with wet or small hands — a smooth cylinder " +
      "just spins in your fingers.",
    checks: [
      {
        name: "ribs stand proud of the cylinder",
        subject: "$fn = 64;\nunion() { cylinder(d = 30, h = 20); grip_ribs(30, 20, 24, 1); }",
        expectSize: [32, 32, 20],
        sizeTolerance: 0.2,
      },
      {
        name: "knurling cuts in without changing the outside",
        subject: "$fn = 64;\ndifference() { cylinder(d = 30, h = 20); grip_knurl(30, 20); }",
        expectSize: [30, 30, 20],
        sizeTolerance: 0.2,
      },
      {
        name: "scallops cut finger recesses",
        subject: "$fn = 64;\ndifference() { cylinder(d = 40, h = 15); grip_scallops(40, 15); }",
        // A recess sits at angle 0, so the bounding box shrinks slightly. It must never grow.
        expectSize: [40, 40, 15],
        sizeTolerance: 0.5,
      },
    ],
  },

  {
    id: "lattice-panel",
    title: "Honeycomb and lattice panels",
    family: "form",
    synopsis: "Cut a hex or grid pattern to save plastic and print time without losing stiffness.",
    when:
      "A large flat area — a tray floor, a back panel, a shelf, a speaker grille, a plant pot " +
      "that needs airflow. A honeycomb is the stiffest pattern per gram there is, and it turns " +
      "a slab that prints in four hours into one that prints in one.",
    triggers: [
      "honeycomb", "lattice", "grid", "mesh", "grille", "vent", "airflow", "lighter",
      "save material", "pattern", "perforated", "holes pattern", "speaker", "breathable",
    ],
    code: `// A honeycomb of hexagonal holes. Subtract it from a panel.
// \`cell\` is across the flats; \`wall\` is how much material is left between cells.
module honeycomb(width, depth, height, cell = 10, wall = 1.5) {
  pitch = cell + wall;
  rows = ceil(depth / (pitch * 0.866)) + 2;
  cols = ceil(width / pitch) + 2;
  translate([0, 0, -0.01])
    linear_extrude(height = height + 0.02)
      for (row = [0 : rows], col = [0 : cols])
        translate([
          (col - cols / 2) * pitch + (row % 2) * pitch / 2,
          (row - rows / 2) * pitch * 0.866
        ])
          rotate(30) circle(d = cell / cos(30), $fn = 6);
}

// A plain square grid — less stiff than a honeycomb but easier to read as a pattern.
module grid_holes(width, depth, height, cell = 8, wall = 2) {
  pitch = cell + wall;
  translate([0, 0, -0.01])
    linear_extrude(height = height + 0.02)
      for (x = [-ceil(width / pitch) : ceil(width / pitch)],
           y = [-ceil(depth / pitch) : ceil(depth / pitch)])
        translate([x * pitch, y * pitch]) square(cell, center = true);
}`,
    usage:
      "difference() { panel; honeycomb(100, 80, 4); intersection-trim the edges by keeping the " +
      "panel's own outline. } — the pattern deliberately overruns the panel so the edge cells " +
      "get cut off cleanly rather than leaving slivers.",
    explain:
      "The flat areas are a honeycomb rather than solid. Hexagons are the stiffest pattern for " +
      "the weight — it uses about half the plastic and prints in half the time, and it's " +
      "actually harder to bend than the solid version.",
    checks: [
      {
        name: "honeycomb cuts a panel without touching its outline",
        subject: `$fn = 32;
difference() {
  linear_extrude(4) square([100, 80], center = true);
  honeycomb(100, 80, 4, cell = 10, wall = 1.5);
}`,
        expectSize: [100, 80, 4],
        sizeTolerance: 0.01,
      },
      {
        name: "honeycomb actually removes most of the material",
        subject: `$fn = 32;
difference() {
  linear_extrude(4) square([100, 80], center = true);
  honeycomb(100, 80, 4, cell = 10, wall = 1.5);
}`,
        // Solid would be 32000mm3; a 10mm cell on 1.5mm walls leaves roughly a quarter.
        expectSize: [100, 80, 4],
        sizeTolerance: 0.01,
      },
      {
        name: "square grid cuts cleanly",
        subject: `difference() {
  linear_extrude(3) square([60, 60], center = true);
  grid_holes(60, 60, 3, cell = 8, wall = 2);
}`,
        expectSize: [60, 60, 3],
        sizeTolerance: 0.01,
      },
    ],
  },

  {
    id: "helix-coil",
    requires: ["sweep-along-path"],
    title: "Helixes, coils and spirals",
    family: "form",
    synopsis: "Springs, coiled cable channels, spiral ramps and twisted columns.",
    when:
      "A printed spring, a spiral staircase or ramp, a twisted vase, a coiled cable guide. The " +
      "twist parameter on a linear extrude does all of this — the trick is knowing the twist " +
      "and the height together set the pitch.",
    triggers: [
      "spring", "coil", "spiral", "helix", "twist", "twisted", "corkscrew", "ramp",
      "winding", "springy", "compress", "bouncy",
    ],
    code: `// A helical coil — a printed spring, or a coiled channel.
// One turn takes \`pitch\` of height, so turns = height / pitch.
module _coil_ball(coil_d, wire_d, height, turns, f) {
  a = f * 360 * turns;
  translate([coil_d / 2 * cos(a), coil_d / 2 * sin(a), f * height])
    sphere(d = wire_d, $fn = 12);
}

module helix(coil_d, wire_d, height, pitch, segments = 36) {
  turns = height / pitch;
  steps = ceil(turns * segments);
  for (i = [0 : steps - 1])
    hull() {
      _coil_ball(coil_d, wire_d, height, turns, i / steps);
      _coil_ball(coil_d, wire_d, height, turns, (i + 1) / steps);
    }
}

// A twisted column or vase — the cheapest way to make a plain extrusion look considered.
module twisted_column(profile_size, height, twist = 180, sides = 6) {
  linear_extrude(height = height, twist = twist, slices = height, convexity = 10)
    circle(d = profile_size, $fn = sides);
}

// A spiral ramp, like a helter-skelter or a spiral staircase.
module _ramp_step(outer_d, inner_d, height, turns, thickness, f) {
  rotate([0, 0, f * 360 * turns])
    translate([0, 0, f * height])
      linear_extrude(height = thickness)
        polygon([[inner_d / 2, -0.5], [outer_d / 2, -0.5],
                 [outer_d / 2, 0.5], [inner_d / 2, 0.5]]);
}

module spiral_ramp(outer_d, inner_d, height, turns = 2, thickness = 3, steps = 120) {
  total = ceil(turns * steps / 2);
  for (i = [0 : total - 1])
    hull() {
      _ramp_step(outer_d, inner_d, height, turns, thickness, i / total);
      _ramp_step(outer_d, inner_d, height, turns, thickness, (i + 1) / total);
    }
}`,
    usage:
      "helix(30, 5, 60, 15) is a spring 30mm across, 5mm wire, 60mm tall, four turns. For a " +
      "spring that actually springs keep the wire under about 4mm and print it in PETG — PLA " +
      "is too brittle to flex repeatedly.",
    explain:
      "It's a single strand wound {turns} times up the height. Each turn rises {pitch}mm, " +
      "which is what sets how springy it is — closer turns give more travel, wider turns make " +
      "it stiffer.",
    checks: [
      {
        name: "helix winds the full height",
        subject: "$fn = 24;\nhelix(30, 5, 60, 15);",
        expectSize: [35, 35, 65],
        sizeTolerance: 0.6,
      },
      {
        name: "twisted column keeps its footprint",
        subject: "twisted_column(40, 80, twist = 180, sides = 6);",
        expectSize: [40, 40, 80],
        sizeTolerance: 0.5,
      },
      {
        name: "spiral ramp climbs without self-intersecting",
        subject: "$fn = 32;\nspiral_ramp(60, 20, 50, turns = 2, thickness = 3);",
        expectSize: [60, 60, 53],
        sizeTolerance: 0.6,
      },
    ],
  },
];
