import type { ScadPattern } from "./types";

/**
 * The family that decides whether a model survives contact with a printer.
 *
 * None of this shows up on screen. A hole that prints as an oval, a peg that won't go into
 * its socket, a wall thinner than the nozzle — the preview looks perfect every time. So
 * these patterns carry numbers rather than shapes, and the numbers are the point.
 */
export const PRINTABILITY_PATTERNS: ScadPattern[] = [
  {
    id: "teardrop-hole",
    title: "Horizontal holes that print without support",
    family: "printability",
    synopsis: "Give a sideways hole a pointed roof so it prints round instead of sagging oval.",
    when:
      "Every hole whose axis runs horizontally — an axle, a cable pass-through, a bolt going " +
      "in from the side. A plain round horizontal hole has an unsupported overhang at the top " +
      "and prints as a drooping oval. Vertical holes are fine as they are.",
    triggers: [
      "horizontal hole", "sideways hole", "axle", "pin hole", "cable", "pass-through",
      "teardrop", "overhang", "sags", "droop", "support", "through the side",
    ],
    code: `// A circle with a 45-degree pointed roof. The roof never overhangs more than the
// printer can bridge, so a sideways hole comes out round instead of sagging into an oval.
module teardrop_2d(d) {
  r = d / 2;
  hull() {
    circle(r = r);
    // A square stood on its corner: its top point sits at r * sqrt(2), which is exactly
    // where the two 45-degree tangents from the circle meet.
    rotate(45) square(r);
  }
}

// A teardrop hole running along the Y axis, point upward. Subtract it.
module teardrop_hole(d, length) {
  rotate([90, 0, 0]) linear_extrude(height = length, center = true) teardrop_2d(d);
}`,
    usage:
      "difference() { body; teardrop_hole(8, 50); } — make the length longer than the part so " +
      "both ends cut cleanly through. Rotate the whole thing about Z to aim the hole along X.",
    explain:
      "The sideways hole has a slight point at the top rather than being perfectly round. A " +
      "printer builds each layer on the one below, and the top of a round sideways hole has " +
      "nothing under it — so it droops. The point gives it something to build on.",
    checks: [
      {
        name: "teardrop cross-section matches BOSL2",
        subject: "$fn = 64;\nrotate([-90, 0, 0]) linear_extrude(height = 20, center = true) teardrop_2d(10);",
        reference: "include <BOSL2/std.scad>\n$fn = 64;\nteardrop(d = 10, l = 20);",
        tolerance: 2,
      },
      {
        name: "cuts a clean hole through a block",
        subject: `$fn = 64;
difference() {
  translate([0, 0, 10]) cube([40, 30, 20], center = true);
  translate([0, 0, 10]) teardrop_hole(8, 50);
}`,
        expectSize: [40, 30, 20],
        sizeTolerance: 0.01,
      },
    ],
  },

  {
    id: "printable-clearance",
    title: "Clearances — how much gap two parts need",
    family: "printability",
    synopsis: "The gap numbers that decide whether parts slide, snap, press together or seize.",
    when:
      "Any time two printed parts have to meet: a lid on a box, a peg in a hole, a shaft in a " +
      "bearing, a drawer in a case. Modelling them the same size means they will not go " +
      "together — plastic swells slightly as it cools and a printer overshoots on inside corners.",
    triggers: [
      "fit", "clearance", "tolerance", "gap", "slide", "slot in", "press fit", "snug",
      "loose", "tight", "lid", "peg", "socket", "insert", "shaft", "won't fit", "too tight",
      "too loose", "assemble", "two parts", "mate",
    ],
    code: `// Printed parts never come out at exactly the modelled size, so a hole is always cut
// slightly larger than the thing going into it. These are the gaps that work on a
// normal desktop FDM printer with a 0.4mm nozzle.
FIT_PRESS  = 0.10;  // needs a push or a tap. For pins meant to stay put.
FIT_SNUG   = 0.20;  // goes together by hand and holds. Lids, stacking parts.
FIT_SLIDE  = 0.40;  // moves freely. Drawers, hinges, anything that has to turn.
FIT_LOOSE  = 0.60;  // no resistance at all. Captive parts, print-in-place joints.

// Size a hole for a shaft of diameter d. The gap is split around the circle, so the
// clearance value is the gap on each side.
function hole_for(d, fit = FIT_SNUG) = d + 2 * fit;`,
    guidance: `Gaps, per side, on a 0.4mm nozzle:
  press fit  0.10mm   needs a tap; pins that stay put
  snug fit   0.20mm   hand pressure, holds itself; lids, stacking
  sliding    0.40mm   moves freely; drawers, hinges, lids that come off often
  loose      0.60mm   print-in-place parts that must not fuse together

Other numbers that decide whether it prints:
  Minimum wall           0.8mm (two lines). Below this it's a gap, not a wall.
  Comfortable wall        2mm. Use 3mm for anything handled hard or load-bearing.
  Minimum feature         0.5mm. Anything thinner disappears.
  Vertical holes print    0.1-0.2mm undersized — add that back for a close fit.
  First layer squash      adds ~0.2mm to the footprint. A bottom chamfer hides it.`,
    usage:
      "difference() { block; cylinder(d = hole_for(8, FIT_SLIDE), h = 20); } for an 8mm shaft " +
      "that has to turn. Say which fit you chose and why in the summary — it's the number " +
      "someone will want to change first.",
    explain:
      "The hole is {gap}mm wider than the peg all the way round. Printed plastic shrinks a " +
      "little as it cools, so two parts modelled at exactly the same size jam solid — the " +
      "gap is what makes them actually go together.",
    checks: [
      {
        name: "hole_for opens an 8mm shaft to 8.8mm at a sliding fit",
        subject: "$fn = 64;\ncylinder(d = hole_for(8, FIT_SLIDE), h = 5);",
        expectSize: [8.8, 8.8, 5],
        sizeTolerance: 0.01,
      },
      {
        name: "a press fit is tighter than a sliding fit",
        subject: "$fn = 64;\ncylinder(d = hole_for(8, FIT_PRESS), h = 5);",
        expectSize: [8.2, 8.2, 5],
        sizeTolerance: 0.01,
      },
    ],
  },

  {
    id: "overhang-relief",
    title: "Keeping overhangs printable",
    family: "printability",
    synopsis: "The 45° rule, and how to chamfer an overhang away instead of adding support.",
    when:
      "Any face that leans out further than about 45° from vertical, and the underside of any " +
      "hole, lip or ledge. Getting this right is what lets a model print with no support at " +
      "all, which is the difference between a clean part and one that needs cleaning up.",
    triggers: [
      "overhang", "support", "supports", "45 degree", "underside", "ledge", "lip",
      "bridge", "unsupported", "sagging", "print flat", "orientation", "which way up",
    ],
    code: `// A hole with a chamfered underside, so the ceiling of the hole is never a flat
// unsupported overhang. Subtract it.
module supported_hole(d, depth, chamfer = 1) {
  union() {
    translate([0, 0, -0.01]) cylinder(d = d, h = depth + 0.02);
    // A cone under the mouth turns the flat ceiling into a 45-degree climb.
    translate([0, 0, depth - chamfer]) cylinder(d1 = d, d2 = d + 2 * chamfer, h = chamfer);
  }
}

// A shelf or lip with a 45-degree brace underneath instead of a flat overhang.
module supported_lip(length, out, thickness) {
  rotate([90, 0, 0]) translate([0, 0, -length / 2]) linear_extrude(height = length)
    polygon([[0, 0], [out, 0], [out, thickness], [0, thickness + out]]);
}`,
    guidance: `A printer can build a face leaning up to about 45 degrees from vertical with
nothing underneath it. Past that it needs support, which means a rougher surface and
cleanup work.

  Under 45 degrees from vertical   prints clean, no support
  45 to 60 degrees                 prints, surface gets rough
  Over 60 degrees                  needs support
  Flat ceiling, short span         bridges fine up to about 30mm if both ends are anchored
  Flat ceiling, long span          sags

The fix is almost never "add support" — it's to chamfer the overhang to 45 degrees, or to
turn the part over so the overhang points down.`,
    usage: "supported_hole(10, 8, 1) for a blind hole. supported_lip(40, 5, 3) for a shelf.",
    explain:
      "The underside of the {feature} is angled rather than flat. A printer can build outward " +
      "at up to about 45 degrees with nothing beneath it, so angling it means this prints " +
      "cleanly without any support material to snap off afterwards.",
    checks: [
      {
        name: "supported hole keeps the block's outside dimensions",
        subject: `$fn = 64;
difference() {
  cylinder(d = 30, h = 12);
  supported_hole(10, 8, 1);
}`,
        expectSize: [30, 30, 12],
        sizeTolerance: 0.01,
      },
      {
        name: "braced lip is one solid",
        subject: `$fn = 32;
cube([10, 40, 30], center = true);
translate([4, 0, -5]) supported_lip(40, 6, 3);`,
        expectSize: [15, 40, 30],
        sizeTolerance: 0.01,
      },
    ],
  },

  {
    id: "marking-without-text",
    title: "Marks and icons without lettering",
    family: "printability",
    synopsis: "Raise or sink a recognizable shape — this build has no fonts, so text() always fails.",
    when:
      "Someone wants a letter, a number, a name or a symbol on the model. text() cannot work " +
      "here and there is nothing they can do about it, so build the mark out of shapes instead " +
      "and never offer lettering as a direction.",
    triggers: [
      "text", "letter", "name", "number", "label", "engrave", "emboss", "logo", "symbol",
      "icon", "initials", "write", "carve", "marking", "monogram",
    ],
    code: `// Sink a shape into a surface. Deeper than 0.6mm reads well; shallower vanishes
// under the first layer of a rough print.
module engrave(depth = 0.8) {
  translate([0, 0, -depth]) linear_extrude(height = depth + 0.01) children();
}

// Raise a shape off a surface. Keep it at least 1mm proud or it feels like a texture
// rather than a mark.
module emboss(height = 1.2) {
  translate([0, 0, -0.01]) linear_extrude(height = height + 0.01) children();
}

// A rounded arrow, heart, star and the like are all just polygons — build the outline
// from points and offset() it to soften the corners.
module soft_shape(r = 1) {
  offset(r = r) offset(r = -r) children();
}`,
    usage:
      "translate([0, 0, top]) engrave(1) circle(d = 12); — the child is a 2D shape, and the " +
      "call sits at the surface you're marking into.",
    explain:
      "The mark is cut about {depth}mm into the surface. Shapes read much better than " +
      "lettering at this size anyway — a printer lays down lines about 0.4mm wide, so thin " +
      "strokes just disappear.",
    checks: [
      {
        name: "engraving removes material without changing the outside",
        subject: `$fn = 64;
difference() {
  cylinder(d = 40, h = 6);
  translate([0, 0, 6]) engrave(1) circle(d = 12);
}`,
        expectSize: [40, 40, 6],
        sizeTolerance: 0.01,
      },
      {
        name: "soft_shape rounds a polygon's corners",
        subject: "$fn = 64;\nlinear_extrude(3) soft_shape(2) square([30, 20], center = true);",
        expectSize: [30, 20, 3],
        sizeTolerance: 0.05,
      },
    ],
  },
];
