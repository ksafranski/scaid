# Scaid

Describe what you want to build, and Scaid designs it in 3D — then explains, in plain language,
what it made and *why* it made those calls. Aimed at makers from about middle school up.

- **Ask for anything** — "a phone stand angled for video", "a hex keychain with a hole for a ring".
- **Or hand it something** — attach a drawing or photo and Scaid builds a simplified 3D version;
  attach a datasheet or your own notes and it builds to the sizes they give. Pictures, PDFs,
  Markdown and plain text.
- **Spin it around** — the model renders in the browser; drag to spin, scroll to zoom.
- **Measure it** — the ruler in the viewer reads off the build plate: click a spot for its
  position, or drag between two for the distance, the gap on each axis and the angle off the
  plate. Readings stay on the model while you turn it, and land on a corner when you click near
  one, so corner to corner across a 15mm edge reads 15.00 and not 14.8.
- **Cut it open** — slice the model across X, Y or Z and slide the cut through it. The ruler
  still works on the exposed face, so measuring a wall's thickness is one drag.
- **Print it the right way up** — when turning it over would save support, the studio says so
  and offers to turn it. It builds the turned version to check before it tells you.
- **Know what it weighs** — click the size in the toolbar for what the model actually measures:
  volume, weight and filament if it were printed solid, how much of it overhangs, what it
  stands on, and whether it balances. Taken off the mesh, so the numbers are checkable.
- **Understand it** — every build comes with a step-by-step breakdown and the reasoning behind each
  choice. The agent is told what its last build actually measured, so it works from the object
  rather than from what it meant to make.
- **Turn the dials** — the sizes that matter come out as sliders. Drag one and the model
  rebuilds, and the number changes in the code where you can see it. A colour comes out as
  every colour a browser knows, in a grid you pick from by looking.
- **Then change it yourself** — switch the left panel to Code and edit directly. The model
  re-renders as you type, and only when the code actually compiles; errors point at the line.
- **Say what it's for** — the Readme panel is a Markdown editor for the project itself: the
  plan, the measurements you took, what to try next. It's yours, so the agent never rewrites it,
  and a readme saves on its own — you can keep a plan in your library before there's a model.
- **Print it** — set your build plate size (remembered on your account), see the model's real
  dimensions with a warning when it won't fit, and download 3MF or STL for your slicer, or SCAD
  for OpenSCAD.
- **Write it up** — open the spec document for your readme, the picture, the measurements, the
  reasoning and the code as one page. Copy it straight into a Google Doc, or save it as Markdown
  with the picture alongside.
- **Go back** — every version is kept, with what changed between them measured rather than
  guessed: "15mm taller, 75% heavier". Putting one back is recorded too, so nothing is lost by
  looking.
- **Keep it** — builds save to your account and reopen for further work. A record with a readme
  and no model yet is a draft, tagged as one in the library, and opens straight back to the writing.

## Getting started

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | What it's for |
| --- | --- |
| `MONGODB_URI` | Where accounts and creations live. Local: `mongodb://localhost:27017` |
| `MONGODB_DB` | Database name. Defaults to `scaid`. |
| `SESSION_SECRET` | Signs the login cookie. Generate with `openssl rand -base64 32`. |
| `ANTHROPIC_API_KEY` | Powers the design agent. Get one from the [Anthropic Console](https://console.anthropic.com/settings/keys). |
| `ANTHROPIC_MODEL` | Optional. The design pass. Defaults to `claude-opus-5`. |
| `ANTHROPIC_DESIGN_EFFORT` | Optional. How long the design pass thinks before it writes: `low` (default), `medium` or `high`. The biggest cost and latency knob here — turn it up if a complicated build comes back worse. |
| `ANTHROPIC_REPAIR_MODEL` | Optional. The repair pass, which fixes a named fault in code that already exists. Defaults to `claude-sonnet-5` — a narrower job than designing, with the compiler's own message to work from. |
| `SIGNUP_CODE` | The beta signup gate. Required — unset refuses every signup, by design: there's no default in the source, so publishing it can't hand out a working code. |

Then:

```bash
npm run dev
```

Open http://localhost:3000, make an account, and start building.

### The database starts itself

`npm run dev` runs `scripts/dev-mongo.mjs` first, which brings up a local MongoDB in Docker
(container `scaid-mongo`, data in the `scaid-mongo-data` volume so it survives a rebuild). It's
deliberately quiet and never blocks the dev server:

- Mongo already listening → does nothing.
- `MONGODB_URI` points somewhere remote, like Atlas → does nothing.
- Docker isn't running → tells you, and starts Next anyway.

| Command | What it does |
| --- | --- |
| `npm run db:stop` | Stop the local database (your data stays). |
| `npm run db:logs` | Follow the database logs. |
| `SCAID_MONGO_IMAGE=mongo:7 npm run dev` | Use a different image. |

The default image is `mongo:8.2`. `mongo:8` and `mongo:latest` refuse to boot on Linux kernels 6.19
and newer — including Docker Desktop's VM — because of
[SERVER-121912](https://jira.mongodb.org/browse/SERVER-121912); 8.2 is the first release that starts
cleanly.

## How it works

```
you describe it  →  /api/design  →  Claude returns { name, summary, steps, code }
                                          ↓
                    Web Worker runs OpenSCAD (WebAssembly) → OFF mesh
                                          ↓
                          OFF → glTF → <model-viewer> you can spin
```

The agent is constrained to return a structured response — a fun name, a warm summary, a handful of
build steps that each explain *why* a shape was chosen, and the OpenSCAD program itself. The steps
are the point: they're what turns a black box into something a young maker learns from.

### The pattern library

A language model is good at deciding *what* to build and unreliable at working out *how* when the
geometry is genuinely hard. Asked for a threaded lid it writes something thread-shaped and
confidently wrong — in testing, 96% short by volume, and it renders and exports without complaint.

So `src/lib/scadPatterns/` holds 23 worked techniques in plain OpenSCAD: rounded boxes, fillets,
teardrop holes, ISO clearances, screw holes, snap fits, print-in-place hinges, real ISO threads,
involute gears, bearing seats, sweeps, lofts, honeycombs. The agent adapts them instead of
deriving them.

**Every one is graded against [BOSL2](https://github.com/BelfrySCAD/BOSL2) before it ships.**
`npm run verify:patterns` renders each pattern in the same WebAssembly OpenSCAD the browser uses,
renders BOSL2's version of the same solid, and compares volume and outside dimensions — two
programs describing the same object agree on both, however differently they're written. The thread
that was 96% wrong improvised is 1.3% off worked and verified, and renders 2.7× faster than BOSL2's.

BOSL2 is a *reference, never a dependency*. It is not bundled, not served, and never appears in
generated code: a Scaid model is downloaded and opened in someone's own OpenSCAD with nothing
installed beside it, so every program has to stand on its own. The verifier fetches BOSL2 into a
gitignored `.bosl2-cache/`, pinned to a commit.

Patterns reach the agent in two tiers, with no extra round trip. A one-line index of all 23 rides
in the cached system prompt (~720 tokens); the full body of the handful whose triggers match the
request is appended after the cache breakpoint (~0-2.6k tokens). Keyword matching rather than a
retrieval call, because `/api/design` is one streaming structured-output request and needs to stay
that way — the studio reports progress from the fields as they arrive.

`npm run ab:patterns "a jar with a lid that screws on"` asks the real agent the same thing with and
without the library and renders both answers, for checking the claim rather than arguing it.

| Command | What it does |
| --- | --- |
| `npm run verify:patterns` | Grade every technique in the pattern library against BOSL2. |
| `npm run verify:geometry` | Grade the measurements against solids with known answers. |
| `npm run verify:agent` | Check the design response survives a model going off-menu. |
| `npm run verify:patterns thread` | Grade just the patterns whose id matches. |
| `npm run ab:patterns "..."` | Ask the real agent the same thing with and without the library. |

### Dials

A model whose sizes are written into the middle of it can only be changed by rewriting it. So the
agent is asked to name them at the top instead, with a range each, and `src/lib/scadParameters.ts`
turns those into sliders:

```openscad
/* [Size] */
height = 80;        // How tall it stands [40:200]
wall = 2.5;         // Wall thickness [1:0.2:5]
has_lid = true;     // Put a lid on it
```

That's OpenSCAD's own Customizer convention, not a Scaid dialect — open the downloaded file in the
real OpenSCAD and the same controls are there.

Moving a dial writes the number back into the program rather than passing it to the compiler
separately. It costs a little more work and removes a whole category of bug: there is one copy of
every number, so the code you read, the model you see, the STL you download and the program the
agent is handed next turn cannot disagree about how tall it is. It also means you watch the number
change in the code as you drag, which is most of the point — the dial teaches what it does.

A setting the program *paints* with gets every colour a browser knows rather than the handful
listed beside it — told by what the program does with the value, not by what it is called, so a
setting holding "gold" for some other purpose stays a menu. The listed ones stay on top as
suggestions, and the rest are sorted by hue so a grid of them reads as a spectrum: greys collect
at the front and finding "a slightly deeper blue than that" is a matter of looking next to it.

A dial that the program didn't give a step to moves in whole numbers when the program wrote whole
numbers, because a count of grooves has no half. Anything written with a decimal point moves in
tenths or halves instead.

Only a number, `true`/`false`, or one of a listed set of strings is ever written. OpenSCAD parses
these as expressions, so a value carrying a semicolon would be a second statement, and a value that
isn't a number at all becomes `undef` and renders a silently wrong shape rather than an error.
Both are refused before they reach the program.

### Keeping every version

Saving overwrote. That is the wrong shape for a tool whose argument is that a model gets good by
being changed — it kept exactly one of the changes, and the one before the change you regret was
gone.

`src/lib/versions.ts` keeps each turn, with what it measured beside it. Keeping the measurements
is what makes the difference between two versions free to describe: "15mm taller, 75% heavier" is
read off two records rather than by compiling anything, and it cannot disagree with what either
version said when it was current.

A burst of edits is one version. Dragging a dial writes the program on every pause, so a single
decision can land five times in as many seconds; those fold together, while a turn from the agent
never does. Putting a version back is recorded as a change rather than by winding the list back,
so nothing is lost by looking and undoing a restore is just restoring the other one.

Twenty-five are kept, and the cap is re-imposed on the server — a limit only the browser honours
isn't one. If the tab's storage runs short, history is given up oldest-first, because it is the
only thing there that can be surrendered a piece at a time.

### 3MF

STL is a list of loose triangles with no units and no colour: a slicer opening one guesses the
file is in millimetres — usually right, and "usually" is doing work there — and a model coloured
to show its parts arrives grey.

`src/lib/export3mf.ts` writes 3MF instead, which carries both. It has to be written here, because
the WebAssembly OpenSCAD this app ships cannot produce one: `--export-format=3mf` is accepted,
renders without complaint, and writes a **zero-byte file**, lib3mf having been left out of the
build. That turns out better anyway — it's written from the same mesh the viewer is showing, so
what lands on disk is what was on screen rather than the result of compiling the program again.

A 3MF is an OPC package, which is a ZIP of three files, and `src/lib/zip.ts` already writes a
stored-entry ZIP. A model nobody coloured is sent without a colour rather than with the grey the
viewer paints it, because writing that in would tell a slicer to print it grey over whatever was
actually loaded.

The checks read the file back rather than trusting it: unpack the archive, parse the model, and
measure the solid that comes out against the one that went in.

### The ruler landing where you meant

A ray hits wherever it hits, so a click a couple of pixels off a corner is a couple of
millimeters off the answer with nothing on screen to say so. A reading now moves onto the nearest
corner of the model when there is one within fourteen pixels of the click — pixels, converted
against the current zoom, so the reach stays the same under your finger whether the model fills
the screen or sits small in the middle of it. It is 0.5mm zoomed in and 9mm zoomed right out, and
both are the same fourteen pixels.

Corners only, and deliberately. They are the points a caliper would find and the ones the mesh
actually knows. Every other feature worth measuring from — an edge, the middle of a hole — has to
be inferred from triangles that were never told they formed one, which is a different problem
rather than a larger version of this one.

The readout says when a reading was moved, because a point that lands somewhere other than where
it was clicked has to account for itself.

### Measuring what came out

A language model writes a program and never sees the solid it produced. So the studio measures
it: `src/lib/geometry/inspect.ts` takes volume, surface area and center of mass off the mesh the
renderer already made, checks that every edge has exactly two faces on it wound opposite ways,
finds how much surface hangs past 45°, and works out whether the balance point falls inside the
part touching the plate.

Those numbers go three places — the readout behind the size in the toolbar, the spec document,
and the next request to the agent, which is told them as fact and told to say so when they
contradict what it claimed last turn. It rides along in the same single streaming request; there
is no extra round trip.

Two of them are defects rather than facts, and they speak up on their own: a surface that doesn't
close silently produces a broken STL, and a model whose balance point sits outside its footprint
falls over. Overhangs deliberately stay quiet — plenty of good models need support, and a warning
that fires on half of all builds is one people stop reading.

`npm run verify:geometry` grades all of it against solids with closed-form answers: a 20mm cube is
8000mm³ exactly, a `$fn=6` cylinder is a hexagonal prism, a faceted sphere must come out *under*
the smooth one. Surface defects can't be produced by OpenSCAD — its manifold backend always emits
a closed solid — so those checks break a known-good mesh by hand and confirm each one is caught.

### Which way up to print it

Orientation decides whether a print succeeds more than almost anything else, and it's the one
decision a beginner has no reason to know exists. `src/lib/geometry/orientation.ts` measures the
six ways of setting a model down square — there are twenty-four, but eighteen are these six spun
about the vertical, which changes nothing about what rests on the plate or hangs over it.

Judging a stance is a pass over a mesh already in memory, not another compile: turn the vertices,
measure again. That was checked against the real thing rather than assumed, and it agrees exactly
— until a face lands on the 45° line, where the last bit of floating point decides which side it
falls and the two answers differ by a factor of two. A chamfer cut at the steepest safe angle *is*
a face at exactly 45°, so this is common rather than exotic.

So the search is a shortlist, never an answer. The stance at the top of it is compiled and
measured before anyone is told about it, and if the build disagrees, the build wins. Nothing is
said at all unless the saving survives that — or unless it's worth a third of the support or more,
because interrupting someone for a few percent teaches them to stop reading. Nor is a stance
offered that balances the model on a corner or tips it over, however little support it would need.

Accepting it writes a `rotate()` into the program, where it can be read, kept and undone.

### Cutting it open

The measurement people most want is wall thickness, and it's the one the studio deliberately
doesn't compute: every cheap approximation of it averages a thick base with a thin fin and reports
neither, and the correct version is a ray cast against an acceleration structure. So instead the
model gets cut in half and the ruler measures the exposed face — a real number, in a real place.

The cut is made by OpenSCAD rather than by clipping the mesh in the viewer, so the cut face is
real geometry: solid where the part is solid, hollow where it's hollow. `src/lib/geometry/section.ts`
wraps the whole program in a module and differences a half-space out of it, which is verified to
leave an uncut render identical to the original across top-level `$fn`, assignments, nested modules
and functions.

Measurements always describe the whole object, never the slice — a cut is a way of looking at the
thing, not a different thing, so the renderer keeps the uncut mesh apart from the cut one and takes
every number from the former.

Rendering happens entirely in the browser. OpenSCAD is compiled to WebAssembly and runs in a Web
Worker (so the interface never freezes), using the `manifold` backend and exporting `OFF` — which,
unlike STL, carries per-face colour. `src/lib/scadColors.ts` then keeps only the colours the program
explicitly asked for, so OpenSCAD's internal defaults don't leak yellow and green onto the model.

### Layout

| Path | What's there |
| --- | --- |
| `src/app/api/design` | The design agent |
| `src/lib/scadPatterns/` | The verified OpenSCAD technique library and its prompt injection |
| `src/lib/geometry/` | Measuring the mesh, saying it in words, cutting it open and setting it down the right way up |
| `src/lib/scadParameters.ts`, `src/components/Dials.tsx` | The sizes at the top of a program, and the sliders they become |
| `src/lib/designSchema.ts` | The response fields that correct a model rather than reject it |
| `scripts/verify-geometry.mjs` | Grades the measurements against known solids — `npm run verify:geometry` |
| `scripts/verify-patterns.mjs` | Grades every pattern against BOSL2 — `npm run verify:patterns` |
| `scripts/lib/scad-render.mjs` | Renders and measures OpenSCAD in Node, using the browser's own wasm |
| `src/app/api/auth`, `src/lib/auth.ts` | Email + password accounts, signed cookie sessions |
| `src/app/api/creations` | Saving, listing and deleting creations |
| `src/hooks/useScadRenderer.ts` | Drives the render worker, drops stale renders |
| `public/openscad-worker.js`, `public/scad/` | OpenSCAD compiled to WebAssembly |
| `src/io/` | OFF parsing and glTF export, ported from openscad-playground |
| `src/lib/friendlyErrors.ts` | Turns compiler errors into something actionable |
| `src/lib/iconNames.ts`, `src/components/StepIcon.tsx` | The validated icon vocabulary and its duotone artwork |
| `src/components/CodeEditor.tsx` | Live editor: highlighted layer under a transparent textarea |
| `src/hooks/usePanelWidth.ts` | Draggable panel width, remembered per browser |
| `src/lib/studioSession.ts` | Keeps unsaved work alive across navigation and reloads |
| `src/lib/exportStl.ts`, `src/lib/export3mf.ts`, `src/components/PrintControls.tsx` | 3MF/STL/SCAD download, plate size, fit check |
| `src/components/ReadmeEditor.tsx` | The project readme: a Markdown editor with a preview |
| `src/lib/markdown.ts`, `src/components/Markdown.tsx` | Small Markdown reader, and the same AST drawn as React |
| `src/lib/specDocument.ts`, `src/components/SpecDocumentModal.tsx` | The spec document, and its Markdown, HTML and plain-text renderings |
| `src/lib/zip.ts` | Store-only ZIP writer, so the Markdown and its picture download together |
| `src/components/Logo.tsx`, `public/logo.svg`, `src/app/manifest.ts` | The mark, and the installable-app metadata built from it |
| `src/app/api/settings` | Per-account printer settings |
| `src/lib/imageAttachment.ts` | Downscales attached pictures in the browser before upload |
| `src/lib/scadHighlight.ts` | Small OpenSCAD tokenizer for the code viewer |

## Seeing a design from Claude Code

If the designing is happening in a terminal rather than in the studio,
[claude-scad](https://github.com/ksafranski/claude-scad) is this viewer on its own — the same
renderer with no chat, no agent and no account — driven by a Claude Code plugin:

```
/plugin marketplace add ksafranski/claude-scad
/plugin install scad-view@claude-scad
/scad-view
```

It has its own repo and its own deployment, so nothing here has to carry it.

## Installing it

Scaid ships a web app manifest, so it can be installed to a phone home screen or a desktop
dock. The cube mark is the favicon, the apple-touch icon and the maskable Android icon, all
generated from `public/logo.svg` so they stay in step.

## Deploying

Any Node host that runs Next.js works. Set the four environment variables above, and point
`MONGODB_URI` at a hosted database such as MongoDB Atlas.

Note that `public/scad/openscad.wasm` is ~9.6 MB. It's fetched once and then cached by the browser,
but make sure your host serves it with compression and long-lived cache headers.

## Licence note

[BOSL2](https://github.com/BelfrySCAD/BOSL2) is BSD-2-Clause, © 2017-2019 Revar Desmera. It is used
here as a build-time reference — the `npm run verify:patterns` harness grades our own hand-written
OpenSCAD against it. No BOSL2 code is bundled, served, or emitted into a generated model, and the
checkout lives in a gitignored cache. The techniques in `src/lib/scadPatterns/` are written from
scratch and verified against BOSL2's output; where one follows BOSL2's approach closely, the
standard it implements (ISO 68-1 threads, ISO 273 clearance holes, involute tooth profiles) is
named in the code.

OpenSCAD is GPL-2.0. The WebAssembly build in `public/scad/` is shipped unmodified and served to the
browser as a separate file; if you distribute this app publicly, make its corresponding source
available per the GPL.
