#!/usr/bin/env node
/**
 * What `/scad-view` runs: work out which file to look at, and where to look at it.
 *
 * The viewer watches one `.scad` at a time, so something has to decide which — and that
 * decision belongs here rather than in the browser. Node can read the project without
 * asking anyone's permission; a web page can't, and shouldn't be able to. So the scan
 * happens out here and the browser is handed a single path.
 *
 * Prints the URL on a line of its own, and doesn't open anything. Opening is the caller's
 * job: inside Claude Code that means the built-in browser pane, which is nicer than
 * throwing a window at whatever browser happens to be default.
 *
 * Always exits 0. Its output is injected into the skill, and a non-zero exit would abort
 * the whole thing rather than report the problem it found.
 */

import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);

function flag(name) {
  const at = args.indexOf(`--${name}`);
  return at !== -1 && at + 1 < args.length ? args[at + 1] : null;
}

/**
 * Where Scaid is.
 *
 * A `${...}` still in the string means a substitution didn't happen — the skill passes the
 * plugin's setting through one — so it falls through to the environment rather than opening
 * a URL that can't exist.
 */
function host() {
  const given = flag("url");
  const value =
    (given && !given.includes("${") ? given : null) ||
    process.env.CLAUDE_PLUGIN_OPTION_HOST ||
    process.env.SCAID_VIEW_URL ||
    "https://scaid.studio";
  return value.replace(/\/+$/, "");
}

/**
 * Directories never worth walking into.
 *
 * Dependency and build trees are enormous and contain nothing anyone is designing. The
 * dot-directory rule matters more than the list does — it's what keeps `.git` out, and what
 * stops a scan wading through a vendored BOSL2 checkout.
 */
const SKIPPED = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  "__pycache__",
  "venv",
]);

const MAX_DEPTH = 8;

/** The most recently modified `.scad` under a directory, or null if there isn't one. */
async function newestScad(root) {
  let best = null;

  async function walk(dir, depth) {
    if (depth > MAX_DEPTH) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory is simply not a source of candidates
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIPPED.has(entry.name)) await walk(full, depth + 1);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".scad")) continue;

      try {
        const info = await stat(full);
        // Ties break on path so a folder written in one go still picks deterministically.
        if (!best || info.mtimeMs > best.mtimeMs || (info.mtimeMs === best.mtimeMs && full < best.path)) {
          best = { path: full, mtimeMs: info.mtimeMs };
        }
      } catch {
        // Vanished between being listed and being measured.
      }
    }
  }

  await walk(root, 0);
  return best?.path ?? null;
}

/** Best-effort fallback for when there's no browser pane to put this in. */
function openInBrowser(target) {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(opener, [target], { detached: true, stdio: "ignore", shell: process.platform === "win32" })
      .unref();
    return true;
  } catch {
    return false;
  }
}

const at = host();
const named = args.find((value, index) => !value.startsWith("--") && args[index - 1] !== "--url");

let file = named ? resolve(process.cwd(), named) : await newestScad(process.cwd());

if (!file) {
  console.log("No .scad file found in this project yet.");
  console.log("Write one and run /scad-view again, or name one: /scad-view path/to/part.scad");
  process.exit(0);
}

const url = `${at}/scad-view?file=${encodeURIComponent(file)}`;

let up = false;
try {
  const response = await fetch(`${at}/scad-view`, {
    method: "HEAD",
    signal: AbortSignal.timeout(4_000),
  });
  up = response.ok;
} catch {
  up = false;
}

if (!up) {
  console.log(`Scaid isn't answering at ${at}.`);
  console.log("Start it, or change the address with: /plugin config scad-view");
  console.log(`URL: ${url}`);
  process.exit(0);
}

if (args.includes("--open")) openInBrowser(url);

console.log(`FILE: ${file}`);
console.log(`URL: ${url}`);
console.log(
  `Open that URL, then click "Open ${basename(file)}" and choose that file in the dialog. ` +
    "It only ever sees that one file, and every save to it rebuilds the model.",
);
