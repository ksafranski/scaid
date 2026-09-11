import type { ScadPattern } from "./types";

/**
 * Rounding, filleting, chamfering and hollowing.
 *
 * The highest-frequency family by a distance — almost every object touches one of these,
 * and they're exactly where plain OpenSCAD is most painful. A beginner asked to round a
 * box reaches for minkowski(), which is correct and can take thirty seconds; hull() of
 * eight spheres is the same solid in a fraction of the time.
 */
export const EDGE_PATTERNS: ScadPattern[] = [
  {
    id: "rounded-box",
    title: "Box with rounded edges",
    family: "edges",
    synopsis: "Round a box's edges with hull() of spheres or cylinders — never minkowski().",
    when:
      "Any box that should look made rather than cut: enclosures, bases, trays, phone stands. " +
      "Round only the upright edges when the part has to sit flat or stack.",
    triggers: [
      "round", "rounded", "fillet the edge", "soft edge", "smooth edge", "box", "cube",
      "enclosure", "case", "tray", "base", "minkowski", "bevel", "stand", "bracket",
      "holder", "mount", "block", "body",
    ],
    code: `// A box with every edge and corner rounded.
// Eight spheres at the inset corners, wrapped in a single hull — the same solid
// minkowski() would give, but it renders in a fraction of the time.
module rounded_box(size, r) {
  translate([0, 0, size[2] / 2])
    hull() for (x = [-1, 1], y = [-1, 1], z = [-1, 1])
      translate([x * (size[0] / 2 - r), y * (size[1] / 2 - r), z * (size[2] / 2 - r)])
        sphere(r = r);
}

// A box with only the four upright edges rounded, so the top and bottom stay flat.
// This is usually the one you want: it sits flat, stacks, and prints with no support.
module rounded_box_z(size, r) {
  hull() for (x = [-1, 1], y = [-1, 1])
    translate([x * (size[0] / 2 - r), y * (size[1] / 2 - r), 0])
      cylinder(r = r, h = size[2]);
}`,
    usage:
      "rounded_box([40, 30, 20], 4) — sits on the plate, centred on x and y. " +
      "Keep r below half the smallest side.",
    explain:
      "The corners are rounded off by about {r}mm, which is friendlier to hold and much " +
      "stronger — a sharp corner is where a print splits first.",
    checks: [
      {
        name: "all twelve edges, r=3",
        subject: "$fn = 48;\nrounded_box([30, 20, 10], 3);",
        reference: "include <BOSL2/std.scad>\n$fn = 48;\ncuboid([30, 20, 10], rounding = 3, anchor = BOTTOM);",
        tolerance: 1,
      },
      {
        name: "upright edges only, r=5",
        subject: "$fn = 64;\nrounded_box_z([40, 25, 12], 5);",
        reference:
          "include <BOSL2/std.scad>\n$fn = 64;\ncuboid([40, 25, 12], rounding = 5, edges = \"Z\", anchor = BOTTOM);",
        tolerance: 1,
      },
    ],
  },

  {
    id: "fillet-joint",
    title: "Fillet where two parts meet",
    family: "edges",
    synopsis: "Add a curve of material into an inside corner so a joint doesn't snap off.",
    when:
      "Wherever a post, wall, boss or handle meets a flat surface. This is the single " +
      "highest-value change you can make to a printed part's strength — a sharp inside " +
      "corner concentrates stress and is where things break.",
    triggers: [
      "fillet", "inside corner", "brace", "gusset", "reinforce", "strength", "stronger",
      "snapped", "broke", "weak", "post", "boss", "where it meets", "joint", "junction",
      "stand", "bracket", "arm", "leg", "support the", "load",
    ],
    code: `// The 2D wedge that turns a sharp inside corner into a curve: a square with a
// quarter circle bitten out of it.
module fillet_profile(r) {
  difference() {
    square(r);
    translate([r, r]) circle(r = r);
  }
}

// A fillet running around the base of a round post of radius \`at\`.
module fillet_ring(at, r) {
  rotate_extrude() translate([at, 0]) fillet_profile(r);
}

// A fillet running in a straight line along the X axis, for where a wall meets a floor.
module fillet_linear(length, r) {
  translate([-length / 2, 0, 0]) rotate([90, 0, 90])
    linear_extrude(height = length) fillet_profile(r);
}`,
    usage:
      "fillet_ring(10, 4) tucks a 4mm curve around a post of radius 10, sitting on z = 0. " +
      "fillet_linear(60, 3) runs along X at the y = 0, z = 0 corner. A fillet of about " +
      "half the wall thickness is plenty; more just adds plastic.",
    explain:
      "Where the {part} meets the {base} there's a curve of material rather than a sharp " +
      "step. Sharp inside corners are where a print cracks, so this is the difference " +
      "between a part that survives being dropped and one that doesn't.",
    checks: [
      {
        name: "ring fillet round a post matches a negative rounding",
        subject: `$fn = 64;
cylinder(d = 60, h = 6, center = false);
translate([0, 0, 6]) cylinder(d = 20, h = 30);
translate([0, 0, 6]) fillet_ring(10, 4);`,
        reference: `include <BOSL2/std.scad>
$fn = 64;
cyl(d = 60, h = 6, anchor = BOTTOM);
up(6) cyl(d = 20, h = 30, rounding1 = -4, anchor = BOTTOM);`,
        tolerance: 1.5,
      },
      {
        name: "linear fillet along a wall/floor corner",
        subject: `$fn = 64;
cube([60, 40, 4]);
translate([0, 0, 4]) cube([60, 4, 20]);
translate([30, 4, 4]) fillet_linear(60, 3);`,
        expectSize: [60, 40, 24],
        sizeTolerance: 0.01,
      },
    ],
  },

  {
    id: "chamfer",
    title: "Chamfered edges",
    family: "edges",
    synopsis: "Cut a 45° flat off an edge — prints cleaner than a roundover and needs no support.",
    when:
      "A first layer that should not elephant-foot, a lid that has to guide itself into a " +
      "box, or any edge you want knocked off without the render cost of rounding. A chamfer " +
      "on the bottom edge also makes a part much easier to release from the plate.",
    triggers: ["chamfer", "bevel", "45", "knock the edge off", "lead-in", "elephant foot", "taper the edge"],
    code: `// A box with a 45-degree chamfer around the top, the bottom, or both.
// Built as a hull between two rectangles rather than by cutting, so it stays one solid.
module chamfered_box(size, bottom = 0, top = 0) {
  hull() {
    // The waist: full size, spanning between wherever the chamfers end.
    translate([0, 0, bottom])
      linear_extrude(height = max(size[2] - bottom - top, 0.01))
        square([size[0], size[1]], center = true);
    // The pinched-in bottom and top faces.
    if (bottom > 0)
      linear_extrude(height = 0.01)
        square([size[0] - 2 * bottom, size[1] - 2 * bottom], center = true);
    if (top > 0)
      translate([0, 0, size[2] - 0.01])
        linear_extrude(height = 0.01)
          square([size[0] - 2 * top, size[1] - 2 * top], center = true);
  }
}

// A chamfer ring to subtract from the mouth of a hole, so a screw or peg guides itself in.
module chamfer_lead_in(d, depth) {
  translate([0, 0, -0.01])
    cylinder(d1 = d + 2 * depth, d2 = d, h = depth + 0.01);
}`,
    usage:
      "chamfered_box([40, 30, 20], bottom = 1, top = 3). A 0.6-1mm bottom chamfer is the " +
      "standard trick for a clean first layer; 2-3mm on top reads as a deliberate design line.",
    explain:
      "The edges are cut back at an angle rather than rounded. It prints more crisply than a " +
      "curve, and the angle on the bottom edge stops the first layer squashing out into a lip.",
    checks: [
      {
        name: "chamfered bottom matches BOSL2",
        subject: "$fn = 32;\nchamfered_box([40, 30, 20], bottom = 2);",
        reference:
          "include <BOSL2/std.scad>\n$fn = 32;\ncuboid([40, 30, 20], chamfer = 2, edges = BOTTOM, anchor = BOTTOM);",
        tolerance: 1,
      },
      {
        name: "lead-in cuts a cone into a hole mouth",
        subject: `$fn = 64;
difference() {
  cylinder(d = 30, h = 10);
  translate([0, 0, -0.5]) cylinder(d = 8, h = 11);
  translate([0, 0, 10 - 2]) chamfer_lead_in(8, 2);
}`,
        expectSize: [30, 30, 10],
        sizeTolerance: 0.01,
      },
    ],
  },

  {
    id: "hollow-shell",
    title: "Hollow it out, leaving walls and a floor",
    family: "edges",
    requires: ["rounded-box"],
    synopsis: "Turn a solid into a container with a named wall thickness and floor thickness.",
    when:
      "Pots, cups, boxes, trays, enclosures — anything that holds something. Also the fastest " +
      "way to cut print time on a big solid part.",
    triggers: [
      "hollow", "shell", "container", "pot", "cup", "mug", "vase", "box", "bin", "tray",
      "holder", "wall thickness", "inside", "cavity", "planter", "bowl",
    ],
    code: `// A container with a flat floor and even walls.
// The inner cavity is built explicitly rather than offset, which keeps both the wall and
// the floor exactly the thickness you asked for.
module hollow_box(size, wall = 2, floor_t = 2, r = 0) {
  difference() {
    rounded_box_z(size, max(r, 0.01));
    translate([0, 0, floor_t])
      rounded_box_z(
        [size[0] - 2 * wall, size[1] - 2 * wall, size[2] - floor_t + 0.01],
        max(r - wall, 0.01)
      );
  }
}

module hollow_cylinder(d, h, wall = 2, floor_t = 2) {
  difference() {
    cylinder(d = d, h = h);
    translate([0, 0, floor_t]) cylinder(d = d - 2 * wall, h = h - floor_t + 0.01);
  }
}

// A drainage hole pattern for a planter: a ring of holes plus one in the middle.
module drainage_holes(d, count = 6, hole_d = 6, depth = 10) {
  translate([0, 0, -0.01]) cylinder(d = hole_d, h = depth);
  for (i = [0 : count - 1])
    rotate([0, 0, i * 360 / count]) translate([d / 4, 0, -0.01])
      cylinder(d = hole_d, h = depth);
}`,
    usage:
      "hollow_box([60, 40, 30], wall = 2, floor_t = 3, r = 5). Needs rounded-box in the same " +
      "program. Walls under 1.2mm are fragile; 2mm is the safe default, 3mm for anything " +
      "that gets handled hard.",
    explain:
      "It's hollow inside, with {wall}mm walls and a {floor}mm floor. The floor is thicker " +
      "than the walls because it carries the weight of whatever goes in.",
    checks: [
      {
        name: "hollow box keeps its wall and floor thickness",
        subject: `$fn = 48;
hollow_box([60, 40, 30], wall = 2, floor_t = 3, r = 5);`,
        reference: `include <BOSL2/std.scad>
$fn = 48;
diff() {
  cuboid([60, 40, 30], rounding = 5, edges = "Z", anchor = BOTTOM);
  tag("remove") up(3) cuboid([56, 36, 27.01], rounding = 3, edges = "Z", anchor = BOTTOM);
}`,
        tolerance: 1.5,
      },
      {
        name: "hollow cylinder",
        subject: "$fn = 64;\nhollow_cylinder(d = 50, h = 60, wall = 2, floor_t = 3);",
        reference: `include <BOSL2/std.scad>
$fn = 64;
diff() {
  cyl(d = 50, h = 60, anchor = BOTTOM);
  tag("remove") up(3) cyl(d = 46, h = 57.01, anchor = BOTTOM);
}`,
        tolerance: 1,
      },
    ],
  },
];
