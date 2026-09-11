import { EDGE_PATTERNS } from "./edges";
import { PRINTABILITY_PATTERNS } from "./printability";
import { JOINERY_PATTERNS } from "./joinery";
import { MECHANICAL_PATTERNS } from "./mechanical";
import { FORM_PATTERNS } from "./form";
import type { ScadPattern } from "./types";

export type { ScadPattern, PatternFamily, PatternCheck } from "./types";

export const PATTERNS: ScadPattern[] = [
  ...EDGE_PATTERNS,
  ...PRINTABILITY_PATTERNS,
  ...JOINERY_PATTERNS,
  ...MECHANICAL_PATTERNS,
  ...FORM_PATTERNS,
];

const BY_ID = new Map(PATTERNS.map((pattern) => [pattern.id, pattern]));

export function getPattern(id: string): ScadPattern | undefined {
  return BY_ID.get(id);
}

/**
 * A pattern plus everything it calls, dependencies first.
 *
 * OpenSCAD treats a call to an undefined module as a warning and renders an empty file, so
 * a missing dependency doesn't fail loudly — it just silently produces nothing. Resolving
 * the graph is what stops that reaching either the verifier or the person.
 */
export function withDependencies(ids: string[]): ScadPattern[] {
  const resolved: ScadPattern[] = [];
  const seen = new Set<string>();

  const visit = (id: string, trail: string[]) => {
    if (seen.has(id)) return;
    if (trail.includes(id)) {
      throw new Error(`Pattern dependency cycle: ${[...trail, id].join(" -> ")}`);
    }
    const pattern = BY_ID.get(id);
    if (!pattern) throw new Error(`Unknown pattern id: ${id}`);
    for (const dependency of pattern.requires ?? []) visit(dependency, [...trail, id]);
    seen.add(id);
    resolved.push(pattern);
  };

  for (const id of ids) visit(id, []);
  return resolved;
}

/** The OpenSCAD for a pattern and everything it depends on, ready to compile. */
export function patternCode(id: string): string {
  return withDependencies([id])
    .map((pattern) => pattern.code)
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Every name the pattern library defines — modules, functions and shouty constants.
 *
 * The lint uses this to catch a half-pasted pattern. OpenSCAD treats a call to a module it
 * has never heard of as a warning and carries on, so the render comes back empty rather
 * than failing: the worst possible way for this to go wrong, because it looks like nothing
 * happened at all.
 */
export const PATTERN_SYMBOLS: string[] = [
  ...new Set(
    PATTERNS.flatMap((pattern) => [
      ...[...(pattern.code ?? "").matchAll(/^\s*(?:module|function)\s+([A-Za-z_]\w*)/gm)].map(
        (match) => match[1],
      ),
      ...[...(pattern.code ?? "").matchAll(/^([A-Z][A-Z0-9_]*)\s*=(?!=)/gm)].map(
        (match) => match[1],
      ),
    ]),
  ),
];
