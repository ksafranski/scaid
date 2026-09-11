# Scaid

Describe what you want to build, and Scaid designs it in 3D — then explains, in plain language,
what it made and *why* it made those calls. Aimed at makers from about middle school up.

- **Ask for anything** — "a phone stand angled for video", "a hex keychain with a hole for a ring".
- **Or show it a picture** — attach a drawing or photo and Scaid builds a simplified 3D version.
- **Spin it around** — the model renders in the browser; drag to spin, scroll to zoom.
- **Measure it** — the ruler in the viewer reads off the build plate: click a spot for its
  position, or drag between two for the distance, the gap on each axis and the angle off the
  plate. Readings stay on the model while you turn it.
- **Understand it** — every build comes with a step-by-step breakdown and the reasoning behind each
  choice.
- **Then change it yourself** — switch the left panel to Code and edit directly. The model
  re-renders as you type, and only when the code actually compiles; errors point at the line.
- **Say what it's for** — the Readme panel is a Markdown editor for the project itself: the
  plan, the measurements you took, what to try next. It's yours, so the agent never rewrites it,
  and a readme saves on its own — you can keep a plan in your library before there's a model.
- **Print it** — set your build plate size (remembered on your account), see the model's real
  dimensions with a warning when it won't fit, and download STL for your slicer or SCAD for
  OpenSCAD.
- **Write it up** — open the spec document for your readme, the picture, the measurements, the
  reasoning and the code as one page. Copy it straight into a Google Doc, or save it as Markdown
  with the picture alongside.
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
| `ANTHROPIC_MODEL` | Optional. Defaults to `claude-opus-5`. |
| `SIGNUP_CODE` | Optional. Beta signup gate; defaults to `scaidtester`. |

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

Rendering happens entirely in the browser. OpenSCAD is compiled to WebAssembly and runs in a Web
Worker (so the interface never freezes), using the `manifold` backend and exporting `OFF` — which,
unlike STL, carries per-face colour. `src/lib/scadColors.ts` then keeps only the colours the program
explicitly asked for, so OpenSCAD's internal defaults don't leak yellow and green onto the model.

### Layout

| Path | What's there |
| --- | --- |
| `src/app/api/design` | The design agent |
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
| `src/lib/exportStl.ts`, `src/components/PrintControls.tsx` | STL/SCAD download, plate size, fit check |
| `src/components/ReadmeEditor.tsx` | The project readme: a Markdown editor with a preview |
| `src/lib/markdown.ts`, `src/components/Markdown.tsx` | Small Markdown reader, and the same AST drawn as React |
| `src/lib/specDocument.ts`, `src/components/SpecDocumentModal.tsx` | The spec document, and its Markdown, HTML and plain-text renderings |
| `src/lib/zip.ts` | Store-only ZIP writer, so the Markdown and its picture download together |
| `src/components/Logo.tsx`, `public/logo.svg`, `src/app/manifest.ts` | The mark, and the installable-app metadata built from it |
| `src/app/api/settings` | Per-account printer settings |
| `src/lib/imageAttachment.ts` | Downscales attached pictures in the browser before upload |
| `src/lib/scadHighlight.ts` | Small OpenSCAD tokenizer for the code viewer |

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

OpenSCAD is GPL-2.0. The WebAssembly build in `public/scad/` is shipped unmodified and served to the
browser as a separate file; if you distribute this app publicly, make its corresponding source
available per the GPL.
