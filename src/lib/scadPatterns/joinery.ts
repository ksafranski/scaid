import type { ScadPattern } from "./types";

/**
 * Making two printed parts into one object.
 *
 * This is where a model stops being a shape and starts being a thing. Almost all of it
 * comes down to numbers someone can't guess — a clearance hole for an M4 is 4.5mm and no
 * amount of reasoning gets you there.
 */
export const JOINERY_PATTERNS: ScadPattern[] = [
  {
    id: "screw-holes",
    title: "Screw holes — clearance, counterbore, countersink, inserts",
    family: "joinery",
    synopsis: "ISO metric hole sizes for M2-M8, and the four ways a screw meets a part.",
    when:
      "Anything bolted, screwed or mounted. The four cases are: a clearance hole (the screw " +
      "passes through), a counterbore (a socket head sits flush), a countersink (a flat head " +
      "sits flush), and a threaded hole — which on a printed part means either a brass " +
      "heat-set insert or letting the screw cut its own thread.",
    triggers: [
      "screw", "bolt", "m2", "m3", "m4", "m5", "m6", "m8", "countersink", "counterbore",
      "mount", "mounting hole", "fasten", "insert", "heat set", "heatset", "threaded hole",
      "tapped", "machine screw", "attach with", "bolt it", "screw it",
    ],
    code: `// ISO metric screw dimensions, in millimeters.
// [nominal, clearance hole, socket-head counterbore, flat-head top, tap drill,
//  heat-set insert hole, heat-set insert depth]
_SCREWS = [
  [2, 2.4,  4.0,  4.0, 1.6, 3.2,  4.0],
  [3, 3.4,  6.0,  6.0, 2.5, 4.0,  5.7],
  [4, 4.5,  7.5,  8.0, 3.3, 5.6,  8.1],
  [5, 5.5,  9.5, 10.0, 4.2, 6.4,  9.5],
  [6, 6.6, 11.0, 12.0, 5.0, 8.0, 12.7],
  [8, 9.0, 14.0, 16.0, 6.8, 9.5, 12.7],
];
function _screw(size) = _SCREWS[search([size], _SCREWS)[0]];

// The screw passes straight through. This is the hole in the part being held down.
module screw_clearance(size, depth) {
  translate([0, 0, -0.01]) cylinder(d = _screw(size)[1], h = depth + 0.02);
}

// A socket-head cap screw sinks flush. \`bore\` is how deep the head pocket goes.
module screw_counterbore(size, depth, bore = 4) {
  s = _screw(size);
  translate([0, 0, -0.01]) cylinder(d = s[1], h = depth + 0.02);
  translate([0, 0, depth - bore]) cylinder(d = s[2], h = bore + 0.01);
}

// A flat-head screw sinks flush into a 90-degree cone.
module screw_countersink(size, depth) {
  s = _screw(size);
  translate([0, 0, -0.01]) cylinder(d = s[1], h = depth + 0.02);
  // A 90-degree head is as deep as it is wide across the radius.
  translate([0, 0, depth - s[3] / 2]) cylinder(d1 = s[1], d2 = s[3], h = s[3] / 2 + 0.01);
}

// A brass heat-set insert, pushed in with a soldering iron. The strongest way to put a
// real thread in a printed part, and the only one that survives being undone repeatedly.
module heatset_hole(size) {
  s = _screw(size);
  translate([0, 0, -0.01]) cylinder(d = s[5], h = s[6] + 0.01);
  // A slight flare at the mouth so the insert starts straight.
  cylinder(d1 = s[5] + 0.8, d2 = s[5], h = 0.8);
}

// Let the screw cut its own thread in the plastic. Cheap, but it strips if undone often.
module self_tapping_hole(size, depth) {
  translate([0, 0, -0.01]) cylinder(d = size * 0.85, h = depth + 0.01);
}`,
    usage:
      "difference() { part; translate([x, y, 0]) screw_counterbore(4, 12, bore = 5); } — the " +
      "call sits at the face the screw goes into, cutting upward. Leave at least 2mm of " +
      "plastic around a hole or it splits.",
    explain:
      "The mounting holes are sized for {size} screws — {clearance}mm across, which is a bit " +
      "wider than the screw so it drops through without fighting. The wider pocket at the top " +
      "lets the head sit flush instead of standing proud.",
    checks: [
      {
        name: "M4 clearance hole matches BOSL2's ISO dimension",
        subject: "$fn = 64;\nscrew_clearance(4, 20);",
        reference:
          'include <BOSL2/std.scad>\ninclude <BOSL2/screws.scad>\n$fn = 64;\nscrew_hole("M4,20", anchor = BOTTOM);',
        tolerance: 1,
        sizeTolerance: 0.05,
      },
      {
        name: "M3 clearance hole matches BOSL2",
        subject: "$fn = 64;\nscrew_clearance(3, 20);",
        reference:
          'include <BOSL2/std.scad>\ninclude <BOSL2/screws.scad>\n$fn = 64;\nscrew_hole("M3,20", anchor = BOTTOM);',
        tolerance: 1,
        sizeTolerance: 0.05,
      },
      {
        name: "M6 clearance hole matches BOSL2",
        subject: "$fn = 64;\nscrew_clearance(6, 20);",
        reference:
          'include <BOSL2/std.scad>\ninclude <BOSL2/screws.scad>\n$fn = 64;\nscrew_hole("M6,20", anchor = BOTTOM);',
        tolerance: 1,
        sizeTolerance: 0.05,
      },
      {
        name: "counterbore opens to the socket head diameter",
        subject: "$fn = 64;\nscrew_counterbore(4, 12, bore = 5);",
        expectSize: [7.5, 7.5, 12.02],
        sizeTolerance: 0.05,
      },
      {
        name: "M4 heat-set hole is 5.6mm with a 0.8mm flared mouth",
        subject: "$fn = 64;\nheatset_hole(4);",
        expectSize: [6.4, 6.4, 8.1],
        sizeTolerance: 0.05,
      },
      {
        name: "cuts through a real bracket without changing its outside",
        subject: `$fn = 64;
difference() {
  cube([40, 30, 10], center = true);
  translate([-12, 0, -5]) screw_countersink(4, 10);
  translate([12, 0, -5]) screw_counterbore(4, 10, bore = 4);
}`,
        expectSize: [40, 30, 10],
        sizeTolerance: 0.01,
      },
    ],
  },

  {
    id: "tab-slot",
    title: "Tabs and slots",
    family: "joinery",
    synopsis: "Locate two parts against each other so they can't slide or twist apart.",
    when:
      "Two flat parts meeting at a face or an edge. Tabs do the locating; screws or glue do " +
      "the holding. Much stronger than butt-gluing two printed faces, which peel apart along " +
      "the layer lines.",
    triggers: [
      "tab", "slot", "key", "keyed", "locate", "align", "register", "twist", "slide apart",
      "two halves", "join", "lock together", "peg", "dowel", "assemble",
    ],
    code: `// A row of tabs along the X axis. Add these to one part.
module tabs(count, size, spacing) {
  for (i = [0 : count - 1])
    translate([(i - (count - 1) / 2) * spacing, 0, 0])
      cube(size, center = true);
}

// The matching slots, opened up by \`fit\` on every face so they actually go together.
// Use FIT_SNUG (0.2) for a joint that stays put, FIT_SLIDE (0.4) for one that comes apart.
module tab_slots(count, size, spacing, fit = 0.2) {
  tabs(count, [size[0] + 2 * fit, size[1] + 2 * fit, size[2] + 2 * fit], spacing);
}

// A round peg and its socket — the simplest locating pair, and it can't be put in wrong.
module locating_peg(d, h, chamfer = 0.6) {
  cylinder(d1 = d, d2 = d - 2 * chamfer, h = chamfer);
  cylinder(d = d, h = h - chamfer);
  translate([0, 0, h - chamfer]) cylinder(d1 = d, d2 = d - 2 * chamfer, h = chamfer);
}

module locating_socket(d, h, fit = 0.2) {
  translate([0, 0, -0.01]) cylinder(d = d + 2 * fit, h = h + 0.01);
}`,
    usage:
      "tabs(3, [8, 4, 3], 14) on the lower part, tab_slots(3, [8, 4, 3], 14) subtracted from " +
      "the upper one — same numbers both times, and the fit gap is added for you. Keep tabs " +
      "at least 2mm thick or they shear off.",
    explain:
      "Three tabs along the edge drop into matching slots, so the two halves can only go " +
      "together one way and can't slide once they're there. The slots are {fit}mm bigger all " +
      "round, which is what makes them push together rather than jam.",
    checks: [
      {
        name: "slots are bigger than the tabs they take",
        subject: "tab_slots(3, [8, 4, 3], 14, fit = 0.2);",
        expectSize: [36.4, 4.4, 3.4],
        sizeTolerance: 0.01,
      },
      {
        name: "tabs and slots actually mate",
        subject: `difference() {
  translate([0, 0, 3]) cube([50, 20, 6], center = true);
  tab_slots(3, [8, 4, 3], 14, fit = 0.2);
}
tabs(3, [8, 4, 3], 14);`,
        expectSize: [50, 20, 7.5],
        sizeTolerance: 0.01,
      },
      {
        name: "peg fits its socket",
        subject: `$fn = 48;
difference() {
  translate([0, 0, -5]) cube([30, 30, 10], center = true);
  translate([0, 0, -8]) locating_socket(6, 8, fit = 0.2);
}
locating_peg(6, 8);`,
        expectSize: [30, 30, 18],
        sizeTolerance: 0.05,
      },
    ],
  },

  {
    id: "snap-fit",
    title: "Snap fit",
    family: "joinery",
    synopsis: "A cantilever hook that flexes past a ledge and clicks — no screws, opens by hand.",
    when:
      "A lid, a battery cover, a case that has to come apart without tools. The arm has to be " +
      "long and thin enough to bend: too short and it snaps off the first time.",
    triggers: [
      "snap", "click", "clip", "latch", "catch", "no screws", "tool-free", "battery cover",
      "lid that clicks", "pops on", "press fit lid", "removable lid",
    ],
    code: `// A cantilever snap hook. The arm bends as the sloped face rides over the ledge, then
// springs back so the flat face underneath holds it shut.
//
// Rule of thumb: the arm wants to be at least 10x the hook depth long, or it can't bend
// far enough and breaks instead.
module snap_hook(arm_length, arm_width, arm_thickness, hook = 1.2) {
  union() {
    // The flexing arm.
    cube([arm_width, arm_thickness, arm_length], center = false);
    // The hook: a wedge that slopes on the way in and is flat on the way out.
    translate([0, arm_thickness, arm_length - hook * 2])
      rotate([90, 0, 0]) linear_extrude(height = arm_thickness)
        polygon([[0, 0], [arm_width, 0], [arm_width, hook * 2], [0, hook * 2]]);
    translate([0, arm_thickness, arm_length - hook * 2])
      rotate([90, 0, 90]) linear_extrude(height = arm_width)
        polygon([[0, 0], [hook, 0], [0, hook * 2]]);
  }
}

// The ledge the hook catches on, cut into the matching part.
module snap_catch(width, hook = 1.2, depth = 3) {
  translate([0, -0.01, 0]) cube([width, hook + 0.3, depth]);
}`,
    usage:
      "snap_hook(14, 8, 2, 1.2) — a 14mm arm, 8mm wide, 2mm thick, catching on a 1.2mm ledge. " +
      "Thinner arms bend more easily; 1.5-2.5mm is the useful range in PLA.",
    explain:
      "The lid has flexible arms with a small hook on the end. Pushing it on bends the arms " +
      "outward until the hook slips past its ledge and springs back with a click. The arms " +
      "are {length}mm long so they can bend that far without cracking — a short stubby arm " +
      "would just break.",
    checks: [
      {
        name: "hook stands proud of the arm",
        subject: "snap_hook(14, 8, 2, 1.2);",
        expectSize: [8, 3.2, 14],
        sizeTolerance: 0.05,
      },
      {
        name: "catch is deeper than the hook it takes",
        subject: `difference() {
  cube([20, 6, 10]);
  translate([6, 0, 3]) snap_catch(8, 1.2, 3);
}`,
        expectSize: [20, 6, 10],
        sizeTolerance: 0.01,
      },
    ],
  },

  {
    id: "print-in-place-hinge",
    title: "Hinges that print already assembled",
    family: "joinery",
    synopsis: "A barrel hinge with enough gap that the parts never fuse, and a thin living hinge.",
    when:
      "A lid that opens, a folding part, a box with a flap. A print-in-place hinge comes off " +
      "the plate working with nothing to assemble — but only if the gap is big enough that the " +
      "two halves don't weld together, which is the one thing that makes these fail.",
    triggers: [
      "hinge", "fold", "flap", "lid that opens", "swing", "pivot", "rotate open",
      "living hinge", "bendy", "flexible joint", "opens and closes", "door",
    ],
    code: `// A barrel hinge printed in one piece. The 0.5mm gap between knuckles is what stops
// the two halves fusing — tighten it below about 0.4mm and it will come out as one solid.
module hinge_knuckles(width, d, count = 5, gap = 0.5, odd = true) {
  segment = width / count;
  for (i = [0 : count - 1])
    if ((i % 2 == 0) == odd)
      translate([-width / 2 + i * segment + gap / 2, 0, 0])
        rotate([0, 90, 0]) cylinder(d = d, h = segment - gap);
}

// The pin hole runs the full width through both sets of knuckles.
module hinge_pin_hole(width, pin_d, fit = 0.4) {
  rotate([0, 90, 0]) translate([0, 0, -width / 2 - 1])
    cylinder(d = pin_d + 2 * fit, h = width + 2);
}

// A living hinge: a deliberately thin strip that bends because it's thin. No moving parts
// at all. 0.4-0.6mm is the window — thicker won't bend, thinner tears.
module living_hinge(width, length, thickness = 0.5) {
  translate([-width / 2, -length / 2, 0]) cube([width, length, thickness]);
}`,
    usage:
      "hinge_knuckles(40, 8, 5, odd = true) on one half and odd = false on the other, then " +
      "subtract hinge_pin_hole(40, 3) from both. Print it lying flat so the knuckles aren't " +
      "built on top of each other.",
    explain:
      "The hinge prints already put together. The interlocking barrels have a {gap}mm gap " +
      "between them — just wide enough that the printer can't bridge across and weld the two " +
      "halves into one lump, which is the usual way these fail.",
    checks: [
      {
        name: "knuckles interleave without touching",
        subject: `$fn = 48;
hinge_knuckles(40, 8, 5, gap = 0.5, odd = true);
hinge_knuckles(40, 8, 5, gap = 0.5, odd = false);`,
        expectSize: [39.5, 8, 8],
        sizeTolerance: 0.1,
      },
      {
        name: "pin hole clears the pin",
        subject: "$fn = 48;\nhinge_pin_hole(40, 3, fit = 0.4);",
        expectSize: [42, 3.8, 3.8],
        sizeTolerance: 0.05,
      },
      {
        name: "living hinge stays in the bendable thickness window",
        subject: "living_hinge(30, 6, 0.5);",
        expectSize: [30, 6, 0.5],
        sizeTolerance: 0.01,
      },
    ],
  },

  {
    id: "stacking-lip",
    title: "Lids and stacking lips",
    family: "joinery",
    synopsis: "A stepped rim so a lid sits on a box without sliding, or so boxes stack.",
    when:
      "A container with a lid, or parts meant to stack. The lip does the locating; without " +
      "one a lid just slides off. Needs a real clearance or the lid won't go on at all.",
    triggers: [
      "lid", "cap", "cover", "top", "stack", "stackable", "nest", "rim", "lip",
      "sits on top", "closes", "container with a lid", "box and lid",
    ],
    code: `// A rim stepped inward, so a lid drops over it and locates itself.
// Put this on the box; the lid is just a flat plate with a matching skirt.
module stacking_lip(size, wall = 2, lip_h = 4, fit = 0.2) {
  inner = [size[0] - 2 * wall - 2 * fit, size[1] - 2 * wall - 2 * fit];
  difference() {
    linear_extrude(height = lip_h) square(inner, center = true);
    translate([0, 0, -0.01])
      linear_extrude(height = lip_h + 0.02)
        square([inner[0] - 2 * wall, inner[1] - 2 * wall], center = true);
  }
}

// The matching lid: a plate with a skirt that drops over the box's outside.
module lid_with_skirt(size, wall = 2, skirt = 5, plate = 2, fit = 0.2) {
  outer = [size[0] + 2 * fit, size[1] + 2 * fit];
  linear_extrude(height = plate) square(outer, center = true);
  translate([0, 0, plate])
    difference() {
      linear_extrude(height = skirt) square(outer, center = true);
      translate([0, 0, -0.01])
        linear_extrude(height = skirt + 0.02)
          square([outer[0] - 2 * wall, outer[1] - 2 * wall], center = true);
    }
}`,
    usage:
      "stacking_lip([60, 40, 30], wall = 2, lip_h = 4) sitting on the box's rim, and " +
      "lid_with_skirt([60, 40], wall = 2) for the lid. A 0.2mm fit is snug; use 0.4 if it " +
      "comes off often.",
    explain:
      "The box has a raised inner rim and the lid drops over it, so it locates itself and " +
      "doesn't slide around. The gap between them is {fit}mm — small enough to feel solid, " +
      "big enough that it actually goes on.",
    checks: [
      {
        name: "lip sits inside the box wall",
        subject: "stacking_lip([60, 40, 30], wall = 2, lip_h = 4, fit = 0.2);",
        expectSize: [55.6, 35.6, 4],
        sizeTolerance: 0.01,
      },
      {
        name: "lid skirt clears the box outside",
        subject: "lid_with_skirt([60, 40], wall = 2, skirt = 5, plate = 2, fit = 0.2);",
        expectSize: [60.4, 40.4, 7],
        sizeTolerance: 0.01,
      },
    ],
  },
];
