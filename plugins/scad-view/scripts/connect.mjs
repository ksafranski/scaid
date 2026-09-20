#!/usr/bin/env node
/**
 * What `/scad-view` runs: open the live view for the project you're standing in.
 *
 * There's nothing to configure and nothing to pass along. The project is the working
 * directory, the address came from the plugin's own setting, and the viewer reads the
 * `.scad` files off disk itself — so this only has to work out a URL and open it.
 *
 * Always exits 0. Its output is injected into the skill, and a non-zero exit would abort
 * the whole thing rather than report the problem it found.
 */

import { spawn } from "node:child_process";
import { basename } from "node:path";

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
    "http://localhost:3000";
  return value.replace(/\/+$/, "");
}

/** Best-effort: on a machine without a browser this is a no-op, not a failure. */
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
const project = process.cwd();
// The project path is a hint, not an instruction: the browser can't open a folder it was
// merely told about. It's what lets the tab remember which folder goes with which project,
// so the second visit is one click instead of a trip through a file dialog.
const url = `${at}/scad-view?dir=${encodeURIComponent(project)}`;

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
  console.log(`Once it's up, the live view is: ${url}`);
  process.exit(0);
}

const opened = !args.includes("--no-open") && openInBrowser(url);

console.log(`Live view for ${basename(project)}: ${url}`);
console.log(opened ? "Opened it in your browser." : "Open that to watch.");
console.log(
  `Choose "${basename(project)}" in the folder picker it shows. After that, every .scad saved ` +
    "in this project rebuilds there on its own — nothing is uploaded, the page reads the files directly.",
);
