/**
 * Renders OpenSCAD source with the exact WebAssembly build the browser uses.
 *
 * The point is that "it works" means "it works in Scaid", not "it works in whatever
 * OpenSCAD happens to be on this machine". So this loads public/scad/openscad.wasm
 * rather than shelling out to a native binary, and mounts libraries the same way the
 * worker would if it ever needed to.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCAD_DIR = path.join(ROOT, "public", "scad");

// The web build fetches its .wasm over HTTP, which Node's fetch refuses for file://.
// Handing it the bytes up front skips that path entirely.
const WASM = fs.readFileSync(path.join(SCAD_DIR, "openscad.wasm"));
const loadModule = (await import(path.join(SCAD_DIR, "openscad.js"))).default;

/** Copies a host directory of .scad files into the instance's virtual filesystem. */
function mount(instance, hostDir, virtualDir) {
  try {
    instance.FS.mkdir(virtualDir);
  } catch {
    // Already there. mkdir is the cheapest way to ask.
  }
  for (const entry of fs.readdirSync(hostDir, { withFileTypes: true })) {
    const from = path.join(hostDir, entry.name);
    const to = `${virtualDir}/${entry.name}`;
    if (entry.isDirectory()) mount(instance, from, to);
    else if (entry.name.endsWith(".scad")) instance.FS.writeFile(to, fs.readFileSync(from, "utf8"));
  }
}

/**
 * Signed volume and bounding box straight off the OFF mesh.
 *
 * Two programs that describe the same solid land on the same volume no matter how
 * differently they got there, which is exactly the comparison a pattern check wants —
 * it can't be fooled by a different module structure or a different triangulation.
 */
function measure(off) {
  const lines = off
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  // The header is either "OFF 8 6 0" on one line, or "OFF" with the counts on the next.
  let cursor;
  let counts;
  if (/^OFF\s+\S/.test(lines[0])) {
    counts = lines[0].slice(3).trim();
    cursor = 1;
  } else {
    counts = lines[1];
    cursor = 2;
  }
  const [vertexCount, faceCount] = counts.split(/\s+/).map(Number);

  const vertices = [];
  for (let i = 0; i < vertexCount; i++) {
    vertices.push(lines[cursor++].split(/\s+/).slice(0, 3).map(Number));
  }

  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis++) {
      if (vertex[axis] < low[axis]) low[axis] = vertex[axis];
      if (vertex[axis] > high[axis]) high[axis] = vertex[axis];
    }
  }

  // Every term below is a product of three coordinates, so summing tetrahedra from the
  // world origin makes each one as large as the model's distance from origin rather than
  // as large as the model. The total is the same in exact arithmetic and not in floating
  // point, so a part modeled far from center would lose volume to cancellation. Measuring
  // from the middle of the model keeps the terms the size of the thing being measured.
  const origin = low.map((value, axis) => (value + high[axis]) / 2);

  let volume = 0;
  for (let i = 0; i < faceCount; i++) {
    // A face line is "n i0 i1 ... [r g b a]", so only the first n + 1 numbers are indices.
    const parts = lines[cursor++].split(/\s+/).map(Number);
    const face = parts.slice(1, 1 + parts[0]);
    for (let j = 1; j < face.length - 1; j++) {
      const [a, b, c] = [vertices[face[0]], vertices[face[j]], vertices[face[j + 1]]].map(
        (vertex) => vertex.map((value, axis) => value - origin[axis]),
      );
      volume +=
        (a[0] * (b[1] * c[2] - c[1] * b[2]) -
          a[1] * (b[0] * c[2] - c[0] * b[2]) +
          a[2] * (b[0] * c[1] - c[0] * b[1])) /
        6;
    }
  }

  return {
    volume: Math.abs(volume),
    size: high.map((h, axis) => h - low[axis]),
    vertices: vertexCount,
  };
}

/**
 * Compiles a program and measures the solid it produced.
 *
 * @param {string} source OpenSCAD program.
 * @param {{ libraries?: string, includeOff?: boolean }} [options] `libraries` is a host
 *   directory to mount at /libraries, for reference programs that lean on BOSL2 — pattern
 *   code never gets one, that's the point. `includeOff` returns the raw mesh alongside the
 *   measurements, for a checker that wants to parse it the way the browser does.
 * @returns {Promise<{ volume: number, size: number[], vertices: number, ms: number, off?: string } | { error: string }>}
 */
export async function render(source, options = {}) {
  const stderr = [];
  const instance = await loadModule({
    wasmBinary: WASM,
    noInitialRun: true,
    print: () => {},
    printErr: (line) => {
      if (line.includes("Manifold constructor") || line.includes("Manifold: ")) return;
      // Printed on every run, whatever happens, and never once useful.
      if (line.includes('Could not initialize localization')) return;
      stderr.push(line);
    },
  });

  if (options.libraries) {
    instance.ENV.OPENSCADPATH = "/libraries";
    mount(instance, options.libraries, "/libraries");
  }

  instance.FS.writeFile("/input.scad", source);

  const started = Date.now();
  try {
    instance.callMain([
      "/input.scad",
      "-o",
      "/output.off",
      "--backend=manifold",
      "--export-format=off",
    ]);
  } catch (error) {
    return { error: stderr.join("\n") || error.message };
  }
  const ms = Date.now() - started;

  const failures = stderr.filter((line) => line.includes("ERROR:"));
  if (failures.length) return { error: failures.join("\n") };

  let off;
  try {
    off = instance.FS.readFile("/output.off", { encoding: "utf8" });
  } catch {
    return { error: "The program compiled but produced no geometry." };
  }

  return {
    ...measure(off),
    ms,
    warnings: stderr.filter((line) => line.includes("WARNING:")),
    ...(options.includeOff ? { off } : {}),
  };
}
