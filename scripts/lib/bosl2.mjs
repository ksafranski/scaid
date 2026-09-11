/**
 * Fetches BOSL2 — the reference library the pattern checks are graded against.
 *
 * BOSL2 is deliberately NOT a dependency of the app. Nothing here ships to the browser
 * and no generated model ever includes it: a Scaid build has to open in a plain OpenSCAD
 * install with nothing installed alongside it. BOSL2's job is to be the known-good answer
 * that our own hand-written patterns are checked against, which is a build-time concern.
 *
 * Pinned to a commit so a check that passes today passes tomorrow. Bump it deliberately.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const BOSL2_REPO = "https://github.com/BelfrySCAD/BOSL2.git";
export const BOSL2_COMMIT = "4e031aafe189efcf4eb0250c24d3216b6a429458";

const CACHE = path.join(ROOT, ".bosl2-cache");
const CHECKOUT = path.join(CACHE, "BOSL2");

/**
 * @returns {string} Host directory to mount at /libraries — it contains BOSL2/, so
 *   `include <BOSL2/std.scad>` resolves.
 */
export function ensureBosl2() {
  const stamp = path.join(CACHE, ".commit");
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8").trim() === BOSL2_COMMIT) {
    return CACHE;
  }

  fs.rmSync(CACHE, { recursive: true, force: true });
  fs.mkdirSync(CACHE, { recursive: true });

  const git = (...args) => execFileSync("git", args, { cwd: CACHE, stdio: ["ignore", "pipe", "pipe"] });

  process.stdout.write("Fetching BOSL2 (reference library, not shipped)... ");
  git("init", "--quiet", "BOSL2");
  execFileSync("git", ["remote", "add", "origin", BOSL2_REPO], { cwd: CHECKOUT });
  execFileSync("git", ["fetch", "--quiet", "--depth", "1", "origin", BOSL2_COMMIT], {
    cwd: CHECKOUT,
  });
  execFileSync("git", ["checkout", "--quiet", "FETCH_HEAD"], { cwd: CHECKOUT });
  fs.writeFileSync(stamp, BOSL2_COMMIT);
  console.log("done.");

  return CACHE;
}
