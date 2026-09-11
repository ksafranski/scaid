/**
 * Grades every pattern against BOSL2.
 *
 * A pattern claims to build something — a fillet, an ISO thread, an involute gear. This
 * renders that claim in the same WebAssembly OpenSCAD the browser runs, renders BOSL2's
 * version of the same solid, and compares the volume and the outside dimensions. Two
 * programs describing the same object agree on both no matter how differently they're
 * written, so the comparison can't be fooled by a different module structure.
 *
 * This exists because the failure mode it catches is invisible. A wrong thread still
 * renders, still looks like a thread, and still exports. Only a measurement says it's 96%
 * short of the real thing.
 *
 *   npm run verify:patterns            every pattern
 *   npm run verify:patterns thread     just the ones whose id matches
 */
import { render } from "./lib/scad-render.mjs";
import { ensureBosl2 } from "./lib/bosl2.mjs";

const { PATTERNS, patternCode } = await import("../src/lib/scadPatterns/index.ts");

const filter = process.argv[2];
const patterns = filter ? PATTERNS.filter((p) => p.id.includes(filter)) : PATTERNS;

const libraries = patterns.some((p) => p.checks?.some((c) => c.reference)) ? ensureBosl2() : null;

const DEFAULT_TOLERANCE = 2;
const DEFAULT_SIZE_TOLERANCE = 0.5;

let passed = 0;
const failures = [];

/**
 * Two structural checks before the geometry.
 *
 * The agent pastes several patterns into one program, so they have to coexist: two patterns
 * defining the same module name would produce a program where one silently shadows the other.
 * Only meaningful over the whole library, so it's skipped when a filter is in play.
 */
if (!filter) {
  const owners = new Map();
  for (const pattern of PATTERNS) {
    for (const name of symbolsOf(pattern)) {
      if (owners.has(name)) {
        failures.push({
          pattern: pattern.id,
          name: "unique symbols",
          reason: `defines ${name}, which ${owners.get(name)} already defines — one would shadow the other`,
        });
      } else {
        owners.set(name, pattern.id);
      }
    }
  }

  const everything = PATTERNS.map((pattern) => pattern.code).filter(Boolean).join("\n\n");
  const together = await render(`${everything}\n\ncube(1);\n`);
  if (together.error) {
    failures.push({
      pattern: "(library)",
      name: "all patterns in one program",
      reason: `the whole library does not compile together\n${indent(together.error)}`,
    });
  } else {
    console.log(`  ok  (library) › all ${PATTERNS.length} patterns compile in one program`);
    passed++;
  }
}

function symbolsOf(pattern) {
  return [...(pattern.code ?? "").matchAll(/^\s*(?:module|function)\s+([A-Za-z_]\w*)/gm)].map(
    (match) => match[1],
  );
}

for (const pattern of patterns) {
  if (!pattern.checks?.length) {
    if (pattern.code) failures.push({ pattern: pattern.id, name: "—", reason: "has code but no checks" });
    continue;
  }

  for (const check of pattern.checks) {
    const label = `${pattern.id} › ${check.name}`;
    // Dependencies first: a pattern that calls a module it doesn't define renders nothing.
    const source = `${patternCode(pattern.id)}\n\n${check.subject}\n`;

    const subject = await render(source);
    if (subject.error) {
      failures.push({ pattern: pattern.id, name: check.name, reason: `subject failed to render\n${indent(subject.error)}` });
      continue;
    }

    const tolerance = check.tolerance ?? DEFAULT_TOLERANCE;
    const sizeTolerance = check.sizeTolerance ?? DEFAULT_SIZE_TOLERANCE;

    if (check.reference) {
      const reference = await render(check.reference, { libraries });
      if (reference.error) {
        failures.push({ pattern: pattern.id, name: check.name, reason: `BOSL2 reference failed to render\n${indent(reference.error)}` });
        continue;
      }

      const drift = (Math.abs(subject.volume - reference.volume) / reference.volume) * 100;
      const sizeDrift = subject.size.map((value, axis) => Math.abs(value - reference.size[axis]));
      const worstSize = Math.max(...sizeDrift);

      if (drift > tolerance || worstSize > sizeTolerance) {
        failures.push({
          pattern: pattern.id,
          name: check.name,
          reason:
            `volume off by ${drift.toFixed(2)}% (allowed ${tolerance}%), ` +
            `size off by ${worstSize.toFixed(2)}mm (allowed ${sizeTolerance}mm)\n` +
            `    ours  ${fmt(subject)}\n    BOSL2 ${fmt(reference)}`,
        });
        continue;
      }

      console.log(`  ok  ${label}  Δvol ${drift.toFixed(2)}%  ${subject.ms}ms vs BOSL2 ${reference.ms}ms`);
      passed++;
      continue;
    }

    if (check.expectSize) {
      const worstSize = Math.max(...subject.size.map((v, axis) => Math.abs(v - check.expectSize[axis])));
      if (worstSize > sizeTolerance) {
        failures.push({
          pattern: pattern.id,
          name: check.name,
          reason: `size off by ${worstSize.toFixed(2)}mm (allowed ${sizeTolerance}mm)\n    ours ${fmt(subject)}\n    want [${check.expectSize.join(", ")}]`,
        });
        continue;
      }
    }

    if (subject.volume <= 0) {
      failures.push({ pattern: pattern.id, name: check.name, reason: "produced no solid volume" });
      continue;
    }

    console.log(`  ok  ${label}  ${subject.volume.toFixed(0)}mm³  ${subject.ms}ms`);
    passed++;
  }
}

function fmt(result) {
  return `vol ${result.volume.toFixed(1)}mm³  size [${result.size.map((n) => n.toFixed(2)).join(", ")}]  ${result.vertices} verts`;
}

function indent(text) {
  return text.split("\n").map((line) => `    ${line}`).join("\n");
}

console.log();
if (failures.length) {
  console.log(`${failures.length} check${failures.length === 1 ? "" : "s"} failed:\n`);
  for (const failure of failures) {
    console.log(`  FAIL  ${failure.pattern} › ${failure.name}`);
    console.log(`        ${failure.reason}\n`);
  }
  console.log(`${passed} passed, ${failures.length} failed.`);
  process.exit(1);
}

console.log(`${passed} check${passed === 1 ? "" : "s"} passed across ${patterns.length} patterns.`);
