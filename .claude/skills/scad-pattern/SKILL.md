---
name: scad-pattern
description: Add or change a technique in the OpenSCAD pattern library at src/lib/scadPatterns — the worked, verified snippets the design agent builds from. Use when adding a modeling technique (a joint, a texture, a mechanism), when a pattern's geometry is wrong, or when a build keeps coming out subtly incorrect in a way a reference implementation would fix.
---

# Adding a pattern to the SCAD library

A pattern is one modeling technique, written in plain OpenSCAD, that the design agent adapts
rather than deriving. The library exists because the agent is good at deciding *what* to
build and unreliable at working out *how* when the geometry is genuinely hard — asked for a
thread it writes something thread-shaped and 96% wrong by volume.

**The rule that makes this work: a pattern is graded against BOSL2 before it ships.** BOSL2
is never a dependency and never reaches the browser — a Scaid model is downloaded and opened
in a plain OpenSCAD install with nothing installed beside it. BOSL2 is the known-good answer
the hand-written code is measured against.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/lib/scadPatterns/types.ts` | The `ScadPattern` shape and what each field is for |
| `src/lib/scadPatterns/{edges,printability,joinery,mechanical,form}.ts` | The patterns, by family |
| `src/lib/scadPatterns/index.ts` | The registry, dependency resolution, `PATTERN_SYMBOLS` |
| `src/lib/scadPatterns/prompt.ts` | Trigger matching and the two-tier prompt injection |
| `scripts/verify-patterns.mjs` | The grader. `npm run verify:patterns [id-fragment]` |
| `scripts/lib/scad-render.mjs` | Renders in the real `public/scad/openscad.wasm` and measures volume + bbox |
| `scripts/lib/bosl2.mjs` | Fetches BOSL2 to `.bosl2-cache`, pinned to a commit |

## Writing one

1. **Find out what BOSL2 actually does.** Read the module in `.bosl2-cache/BOSL2/` — the doc
   comments above each `// Module:` carry the synopsis, arguments and worked examples. Don't
   reason the geometry out from first principles when the reference is right there.

2. **Write the OpenSCAD.** Module and function definitions only, never top-level geometry —
   this gets pasted into a larger program. Follow the app's conventions: millimeters, sitting
   on `z = 0`, centred on x and y, overlaps of 0.01mm where parts fuse. Comment each part in
   the same plain language the agent uses in its steps, because someone reads this to learn.

3. **Declare `requires` if you call another pattern's modules.** This matters more than it
   looks: OpenSCAD downgrades a call to an unknown module to a *warning* and renders an empty
   file. A missing dependency doesn't fail, it silently produces nothing.

4. **Write the checks.** Each one renders `subject` and compares against either a `reference`
   BOSL2 program (by volume and bounding box) or an `expectSize`. Prefer a BOSL2 reference
   wherever one exists — it's the only thing that catches geometry that renders happily and
   is wrong.

5. **Run `npm run verify:patterns <your-id>`** and read the numbers, not just the pass/fail.

6. **Pick triggers generously.** They're matched word-boundary against the request. A pattern
   that appears unneeded costs a few hundred tokens; one that stays hidden costs a wrong
   model. Check your work with a quick script over realistic prompts.

## When a check fails

Read it as evidence, not as an obstacle. Every failure during the original build was real:

- **Volume off by a few percent, bbox exact** — the profile is subtly wrong. Involute gear
  teeth that float free of the root circle look perfect and weigh 7% less.
- **"produced no geometry"** — almost always a missing module, or an `offset(-r)` where `r`
  exceeded half the shape and erased it. Note that `hull_chain() for (...)` is this bug: a
  `for` loop handed to a module counts as **one** child, so `$children` is 1.
- **Size off by exactly a radius** — a swept bar overhangs its end points by half its
  thickness. Usually the expectation is wrong, not the code.
- **Your BOSL2 reference looks wrong** — check it before blaming your own code. A child of
  an attachable BOSL2 shape is positioned relative to the parent's *centre*, not its anchor,
  so `diff() cuboid(...) tag("remove") up(3) cuboid(...)` removes from the wrong place. Use
  siblings under `diff() { ... }`.

## Checks the library enforces for you

- No two patterns may define the same module name (one would silently shadow the other).
- Every pattern's code must compile alongside every other pattern's.
- Any pattern with `code` must have `checks`.
- `src/lib/scadLint.ts` rejects generated code that calls a `PATTERN_SYMBOLS` name it never
  defined, before it reaches the browser.

## Checking it actually helps

`npm run ab:patterns "a jar with a lid that screws on"` asks the real agent the same question
with and without the library and renders both. Two Opus calls, so it's manual on purpose.
