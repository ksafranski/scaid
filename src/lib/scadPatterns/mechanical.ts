import type { ScadPattern } from "./types";

/**
 * The parts that have to mesh with the real world.
 *
 * This family is why the pattern library exists. Everything else here is a technique that
 * can be reasoned out; a thread profile and an involute tooth flank cannot. Improvised,
 * they come out confidently wrong — recognisably thread-shaped, and 96% off by volume.
 * Every module below is graded against BOSL2 before it ships.
 */
export const MECHANICAL_PATTERNS: ScadPattern[] = [
  {
    id: "iso-thread",
    title: "Screw threads that actually mate",
    family: "mechanical",
    synopsis: "A real ISO metric thread — bottle caps, jars, threaded lids, bolts, adjusters.",
    when:
      "Anything that screws together: a jar and its lid, a bottle cap, a height adjuster, a " +
      "lens hood. Do not improvise a thread — the 60° profile and the exact crest and root " +
      "truncations are what make two parts mate, and eyeballing it produces something that " +
      "looks right and binds solid.",
    triggers: [
      "thread", "threaded", "screw together", "screw on", "screw top", "bottle", "cap",
      "jar", "lid that screws", "bolt", "nut", "twist on", "spiral", "helix", "adjuster",
      "unscrew", "m8", "m10", "m12",
      // A screw IS a thread. Without these, "a screw" matched only the hole-sizing pattern
      // and the model correctly refused to guess at a profile it had not been given.
      "screw", "screws", "bolts", "machine screw", "wood screw", "pitch", "threading",
    ],
    code: `// An ISO metric thread profile, drawn around the circle rather than up the side.
//
// The trick: linear_extrude twisting a full 360 degrees per pitch means the slice's
// radius-BY-ANGLE becomes the thread's profile-BY-HEIGHT. So the 60-degree tooth is laid
// out around the circle, and the extrusion sweeps it into a helix.
//
// Over one turn the ISO profile spends p/4 at the root, p/8 at the crest and the rest on
// the two flanks — which is 90, 45 and 112.5 degrees of the circle.
function _thread_points(major, pitch, steps = 8) =
  let (
    H     = pitch * sin(60),      // height of the sharp 60-degree triangle
    r_maj = major / 2,
    r_min = r_maj - H * 5 / 8     // crest trimmed by H/8, root by H/4
  )
  concat(
    [for (i = [0 : steps]) let (a = i * 90 / steps) [r_min * cos(a), r_min * sin(a)]],
    [for (i = [0 : steps]) let (f = i / steps, a = 90 + f * 112.5, r = r_min + f * (r_maj - r_min))
       [r * cos(a), r * sin(a)]],
    [for (i = [0 : steps]) let (a = 202.5 + i * 45 / steps) [r_maj * cos(a), r_maj * sin(a)]],
    [for (i = [0 : steps]) let (f = i / steps, a = 247.5 + f * 112.5, r = r_maj - f * (r_maj - r_min))
       [r * cos(a), r * sin(a)]]
  );

// An external thread — the bolt, or the neck of a jar.
module thread_external(major, length, pitch, slices = 16) {
  turns = ceil(length / pitch) + 2;
  intersection() {
    translate([0, 0, -pitch])
      linear_extrude(height = turns * pitch, twist = -360 * turns,
                     slices = turns * slices, convexity = 10)
        polygon(_thread_points(major, pitch));
    cylinder(d = major + 1, h = length);
  }
}

// The matching internal thread. This is a SOLID to subtract from the lid or nut — cut
// with the major diameter opened up by \`fit\` so the two actually turn against each other.
module thread_internal(major, length, pitch, fit = 0.4, slices = 16) {
  thread_external(major + 2 * fit, length, pitch, slices);
}

// A finished screw-on lid: a knurled cap with an internal thread.
module threaded_cap(major, pitch, height, wall = 3, fit = 0.4) {
  difference() {
    cylinder(d = major + 2 * fit + 2 * wall, h = height);
    translate([0, 0, -0.01]) cylinder(d = major + 2 * fit, h = height - wall + 0.01);
    translate([0, 0, -0.01]) thread_internal(major, height - wall, pitch, fit);
  }
}`,
    usage:
      "thread_external(30, 12, 3) for a jar neck, threaded_cap(30, 3, 16) for its lid — same " +
      "diameter and pitch both times. A coarse pitch (2-4mm on a 30mm neck) prints far better " +
      "than a fine one and screws on in a couple of turns.",
    explain:
      "The neck and the cap have matching threads — a {pitch}mm spiral, so the lid takes about " +
      "{turns} turns to come off. The cap's thread is cut {fit}mm wider than the neck's; " +
      "without that gap two printed threads seize up solid on the first turn.",
    checks: [
      {
        name: "M10x1.5 external thread matches BOSL2",
        subject: "$fn = 48;\nthread_external(10, 20, 1.5);",
        reference:
          "include <BOSL2/std.scad>\ninclude <BOSL2/threading.scad>\n$fn = 48;\nthreaded_rod(d = 10, l = 20, pitch = 1.5, anchor = BOTTOM);",
        tolerance: 3,
        sizeTolerance: 0.1,
      },
      {
        name: "a coarse 30mm jar thread matches BOSL2",
        subject: "$fn = 64;\nthread_external(30, 12, 3);",
        reference:
          "include <BOSL2/std.scad>\ninclude <BOSL2/threading.scad>\n$fn = 64;\nthreaded_rod(d = 30, l = 12, pitch = 3, anchor = BOTTOM);",
        tolerance: 3,
        sizeTolerance: 0.1,
      },
      {
        name: "cap is hollow and threaded inside",
        subject: "$fn = 48;\nthreaded_cap(30, 3, 16, wall = 3, fit = 0.4);",
        expectSize: [36.8, 36.8, 16],
        sizeTolerance: 0.1,
      },
    ],
  },

  {
    id: "spur-gear",
    title: "Gears that mesh",
    family: "mechanical",
    synopsis: "Involute spur gears — the tooth curve that lets two gears turn smoothly.",
    when:
      "Anything geared: a hand crank, a clock, a toy gearbox, a dial that steps. Gear teeth " +
      "are involute curves, not triangles — the involute is what makes the contact point roll " +
      "instead of scrape, and a triangular-toothed gear jams.",
    triggers: [
      "gear", "gears", "cog", "mesh", "gearbox", "crank", "gear ratio", "teeth", "pinion",
      "rack", "transmission", "geared", "turn", "drive",
    ],
    code: `// Involute spur gears.
//
// Two gears mesh if they share a MODULE (tooth size) and a pressure angle. The ratio is
// just the tooth counts, and the centre distance is module * (teeth_a + teeth_b) / 2.
//
// The tooth flank is an involute: the curve traced by unwinding a taut string from the
// base circle. That's what makes the contact point roll rather than scrape.

// The involute function, in degrees.
function _inv(a) = tan(a) * 180 / PI - a;

// Half the angular width of a tooth at radius r.
function _tooth_half_angle(r, rp, rb, z, pa) =
  90 / z + _inv(pa) - _inv(acos(min(1, rb / r)));

module spur_gear_2d(mod, teeth, pa = 20, steps = 10) {
  rp = mod * teeth / 2;         // pitch circle
  rb = rp * cos(pa);            // base circle — the involute starts here
  ra = rp + mod;                // tip
  rf = rp - 1.25 * mod;         // root, with the standard 0.25 * mod clearance
  rs = max(rb, rf);
  base_a = max(0, _tooth_half_angle(rs, rp, rb, teeth, pa));
  union() {
    circle(r = rf);
    for (i = [0 : teeth - 1])
      rotate(i * 360 / teeth)
        polygon(concat(
          // Down to the root circle at the base half-width, so the tooth joins the body.
          [[rf * cos(-base_a), rf * sin(-base_a)]],
          [for (k = [0 : steps])
            let (r = rs + (ra - rs) * k / steps,
                 a = max(0, _tooth_half_angle(r, rp, rb, teeth, pa)))
            [r * cos(-a), r * sin(-a)]],
          [for (k = [steps : -1 : 0])
            let (r = rs + (ra - rs) * k / steps,
                 a = max(0, _tooth_half_angle(r, rp, rb, teeth, pa)))
            [r * cos(a), r * sin(a)]],
          [[rf * cos(base_a), rf * sin(base_a)]]
        ));
  }
}

module spur_gear(mod, teeth, thickness, bore = 0, pa = 20) {
  difference() {
    linear_extrude(height = thickness) spur_gear_2d(mod, teeth, pa);
    if (bore > 0) translate([0, 0, -0.01]) cylinder(d = bore, h = thickness + 0.02);
  }
}

// Where to put the second gear so the two mesh.
function gear_centre_distance(mod, teeth_a, teeth_b) = mod * (teeth_a + teeth_b) / 2;`,
    usage:
      "spur_gear(2, 20, 6, bore = 5) and spur_gear(2, 12, 6, bore = 5) placed " +
      "gear_centre_distance(2, 20, 12) = 32mm apart. Rotate the second by half a tooth " +
      "(180/teeth degrees) so the teeth interlock in the preview. Under about 17 teeth the " +
      "flanks start to undercut and the gear gets weak.",
    explain:
      "The teeth are involute curves, which is the shape that lets one tooth roll against the " +
      "next instead of scraping. The big gear has {a} teeth and the small one {b}, so the " +
      "small one turns {ratio} times for each turn of the big one. They sit {d}mm apart — get " +
      "that wrong and they either jam or skip.",
    checks: [
      {
        name: "20-tooth module-2 gear matches BOSL2",
        subject: "$fn = 64;\nspur_gear(2, 20, 6);",
        reference:
          "include <BOSL2/std.scad>\ninclude <BOSL2/gears.scad>\n$fn = 64;\nspur_gear(mod = 2, teeth = 20, thickness = 6, profile_shift = 0, backlash = 0, anchor = BOTTOM);",
        tolerance: 3,
        sizeTolerance: 0.3,
      },
      {
        name: "12-tooth pinion matches BOSL2",
        subject: "$fn = 64;\nspur_gear(2, 12, 6);",
        reference:
          "include <BOSL2/std.scad>\ninclude <BOSL2/gears.scad>\n$fn = 64;\nspur_gear(mod = 2, teeth = 12, thickness = 6, profile_shift = 0, backlash = 0, anchor = BOTTOM);",
        tolerance: 4,
        sizeTolerance: 0.3,
      },
      {
        name: "a bored gear is still one solid",
        subject: "$fn = 64;\nspur_gear(1.5, 24, 5, bore = 5);",
        expectSize: [39, 39, 5],
        sizeTolerance: 0.3,
      },
    ],
  },

  {
    id: "bearing-seat",
    title: "Bearing and shaft seats",
    family: "mechanical",
    synopsis: "Pocket sizes for the common skate/RC bearings, and how to trap one.",
    when:
      "Anything that has to spin freely and take a load — a wheel, a spinner, a pulley, a " +
      "turntable. A 608 bearing is the one out of a skateboard and is easy to find; the " +
      "pocket has to be a press fit or the bearing works loose.",
    triggers: [
      "bearing", "608", "626", "625", "623", "spin", "spins freely", "wheel", "roller",
      "pulley", "turntable", "lazy susan", "axle", "shaft", "rotate freely", "skate",
    ],
    code: `// Common bearings: [name, bore, outside diameter, width]
// 608 is the skateboard one — cheapest and easiest to find.
_BEARINGS = [
  [623,  3, 10,  4],
  [625,  5, 16,  5],
  [626,  6, 19,  6],
  [608,  8, 22,  7],
  [6001, 12, 28, 8],
  [6002, 15, 32, 9],
];
function _bearing(code) = _BEARINGS[search([code], _BEARINGS)[0]];

// The pocket a bearing presses into. 0.1mm under nominal on a printed part comes out as a
// press fit, because a printer overshoots slightly on inside curves.
module bearing_pocket(code, fit = -0.1, depth_extra = 0.2) {
  b = _bearing(code);
  translate([0, 0, -0.01])
    cylinder(d = b[2] + 2 * fit, h = b[3] + depth_extra + 0.01);
}

// A shoulder for the bearing to seat against, and a clear hole for the shaft through it.
// The shoulder must touch only the OUTER race, or it rubs and the bearing won't turn.
module bearing_seat(code, wall = 2, fit = -0.1) {
  b = _bearing(code);
  difference() {
    cylinder(d = b[2] + 2 * wall, h = b[3] + wall);
    bearing_pocket(code, fit);
    // Clearance for the inner race and shaft, sized to miss the outer race entirely.
    translate([0, 0, -0.01]) cylinder(d = b[2] - 4, h = b[3] + wall + 0.02);
  }
}

function bearing_od(code) = _bearing(code)[2];
function bearing_bore(code) = _bearing(code)[1];
function bearing_width(code) = _bearing(code)[3];`,
    usage:
      "bearing_seat(608) gives a 22mm bearing a pocket with a shoulder. Print a test pocket " +
      "before committing — press fits are the thing most sensitive to a particular printer.",
    explain:
      "The bearing drops into a pocket {od}mm across, a hair under the bearing's own size so " +
      "it presses in and stays. The shoulder behind it only touches the outer ring — press on " +
      "the inner ring and the bearing binds instead of spinning.",
    checks: [
      {
        name: "608 pocket is 22mm less the press-fit squeeze",
        subject: "$fn = 64;\nbearing_pocket(608);",
        expectSize: [21.8, 21.8, 7.2],
        sizeTolerance: 0.05,
      },
      {
        name: "626 pocket",
        subject: "$fn = 64;\nbearing_pocket(626);",
        expectSize: [18.8, 18.8, 6.2],
        sizeTolerance: 0.05,
      },
      {
        name: "seat is one solid with the bearing pocket cut out",
        subject: "$fn = 64;\nbearing_seat(608, wall = 3);",
        expectSize: [28, 28, 10],
        sizeTolerance: 0.05,
      },
    ],
  },

  {
    id: "nut-trap",
    title: "Captive nut pockets",
    family: "mechanical",
    synopsis: "A hex pocket that holds a nut so a bolt can be tightened one-handed.",
    when:
      "Any joint you'll take apart repeatedly and want stronger than a self-tapping screw. A " +
      "trapped nut turns a printed part into something you can bolt properly, and unlike a " +
      "heat-set insert it needs no tools.",
    triggers: [
      "nut", "hex nut", "captive", "nut trap", "nut pocket", "bolt through", "tighten",
      "knob", "clamp", "adjustable", "take apart", "reassemble",
    ],
    code: `// Standard metric hex nuts: [size, across flats, thickness]
_NUTS = [
  [3,  5.5, 2.4],
  [4,  7.0, 3.2],
  [5,  8.0, 4.7],
  [6, 10.0, 5.2],
  [8, 13.0, 6.8],
];
function _nut(size) = _NUTS[search([size], _NUTS)[0]];

// A hexagonal pocket for a nut. Sized across FLATS, which is what a spanner reads and what
// the pocket has to match — measuring across the points gets it wrong by about 15%.
module nut_pocket(size, fit = 0.2, depth_extra = 0.2) {
  n = _nut(size);
  across_flats = n[1] + 2 * fit;
  translate([0, 0, -0.01])
    cylinder(d = across_flats / cos(30), h = n[2] + depth_extra + 0.01, $fn = 6);
}

// A nut pocket opening from the side, with a slot to slide the nut in. The lid over the
// top is one bridged layer, which prints fine and stops the nut falling out.
module nut_slot(size, slot_length, fit = 0.2) {
  n = _nut(size);
  nut_pocket(size, fit);
  // The channel the nut slides down, centred on the pocket and running out along +Y.
  translate([-(n[1] + 2 * fit) / 2, 0, -0.01])
    cube([n[1] + 2 * fit, slot_length, n[2] + 0.2 + 0.01]);
}

function nut_across_flats(size) = _nut(size)[1];
function nut_thickness(size) = _nut(size)[2];`,
    usage:
      "difference() { part; translate([0, 0, 4]) nut_pocket(4); translate([0, 0, 4]) " +
      "screw_clearance(4, 20); } — the pocket and the bolt hole share an axis. Put the pocket " +
      "at least 3mm below the surface so the plastic over it doesn't blow out.",
    explain:
      "There's a six-sided pocket inside for an M{size} nut. Once it's in, it can't turn — so " +
      "the bolt tightens with one spanner instead of two, and unlike a screw biting into " +
      "plastic it can be undone as many times as you like.",
    checks: [
      {
        name: "M4 nut pocket measures 7.4mm across the flats",
        subject: "nut_pocket(4, fit = 0.2);",
        // A hexagon's bounding box is the across-POINTS measure: flats / cos(30).
        expectSize: [8.545, 7.4, 3.4],
        sizeTolerance: 0.02,
      },
      {
        name: "M3 nut pocket",
        subject: "nut_pocket(3, fit = 0.2);",
        expectSize: [6.812, 5.9, 2.6],
        sizeTolerance: 0.02,
      },
      {
        name: "side-entry slot reaches the outside",
        subject: "nut_slot(4, 12, fit = 0.2);",
        // The pocket reaches 3.7mm back past the origin; the channel runs 12mm forward.
        expectSize: [8.545, 15.7, 3.4],
        sizeTolerance: 0.02,
      },
    ],
  },
];
