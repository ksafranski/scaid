import { PATTERNS, getPattern, withDependencies } from "./index";
import type { ScadPattern } from "./types";

/**
 * Turning the pattern library into prompt text.
 *
 * Two tiers, for a reason. The whole library is far too much to send every time, but a
 * pattern the agent never hears about may as well not exist — so the one-line index rides
 * along in the cached system prompt where it costs almost nothing, and the full body of a
 * handful of relevant patterns is appended per request.
 *
 * This deliberately doesn't use a model call or a tool loop to choose. The design endpoint
 * is one streaming structured-output request and needs to stay that way: a retrieval round
 * trip would add seconds to every build and break the field-by-field streaming the studio
 * reports progress from. Keyword matching is free and, for a vocabulary this concrete,
 * close enough.
 */

/** More than this and the prompt starts crowding out the thing being built. */
const MAX_SELECTED = 6;

/** Word-boundary match, so "m3" doesn't fire inside "m30" and "rib" doesn't fire in "ribbon". */
function makeMatcher(trigger: string): RegExp {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i");
}

/** Library order, so a chosen set always renders in the same sequence. */
const ORDER = new Map<string, number>(PATTERNS.map((pattern, index) => [pattern.id, index]));

const MATCHERS = new Map<string, RegExp[]>(
  PATTERNS.map((pattern) => [pattern.id, pattern.triggers.map(makeMatcher)]),
);

/** Every module and function a pattern defines — used to recognise its own work later. */
const DEFINED = new Map<string, string[]>(
  PATTERNS.map((pattern) => [
    pattern.id,
    [...(pattern.code ?? "").matchAll(/^\s*(?:module|function)\s+([A-Za-z_]\w*)/gm)].map(
      (match) => match[1],
    ),
  ]),
);

export interface SelectionInput {
  /** What they asked for this turn. */
  prompt: string;
  /** The program as it stands, if this is a change to an existing build. */
  currentCode?: string;
  /**
   * What this build was made from on an earlier turn, handed back by the studio.
   *
   * The two live routes in — the words of the request, and the modules the program calls —
   * both go quiet after the first turn. The words move on ("make the walls thicker" says
   * nothing about snap fits), and the agent is told to paste pattern code in and rename it
   * to suit the object, which is the right instruction and takes the module names with it.
   * Measured on a real build: five patterns on the first turn, one on the second. So the
   * turn that edits the snap fit is the turn that can no longer see how a snap fit is made.
   *
   * Provenance can't be recovered by looking at the result, which is why it is remembered
   * rather than recomputed.
   */
  remembered?: string[];
}

/** How many remembered patterns a build may carry. */
const MAX_REMEMBERED = 8;

/**
 * Picks the patterns worth sending.
 *
 * Two ways in. A request that talks about threads gets the thread pattern. And code that
 * already CALLS a pattern's modules gets that pattern back — otherwise a follow-up turn
 * would be asked to edit a thread it can no longer see the definition of, and would
 * quietly rewrite it into something that no longer mates.
 */
export function selectPatterns({ prompt, currentCode, remembered }: SelectionInput): ScadPattern[] {
  const haystack = prompt.toLowerCase();
  // Anything the caller can't have meant is dropped rather than trusted: these ids arrive
  // from a browser, and withDependencies throws on one it has never heard of.
  const carried = new Set(
    (remembered ?? []).filter((id) => getPattern(id) !== undefined).slice(0, MAX_REMEMBERED),
  );

  const scored = PATTERNS.map((pattern) => {
    const matchers = MATCHERS.get(pattern.id) ?? [];
    let score = matchers.reduce((total, matcher) => total + (matcher.test(haystack) ? 1 : 0), 0);

    // Already in play: the code in front of us calls something this pattern defines.
    if (currentCode) {
      const defined = DEFINED.get(pattern.id) ?? [];
      if (defined.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(currentCode))) {
        score += 10;
      }
    }

    // What the build is known to be made from outranks both. A pattern that was used is
    // relevant to every turn that follows, whatever this turn's message happens to mention.
    if (carried.has(pattern.id)) score += 20;

    return { pattern, score };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score);

  // Sorted back into library order once the cut is made, so the same set of patterns always
  // renders the same bytes. Score order would reshuffle the brief whenever a word in the
  // request changed, and a cached prefix that changes is not a cached prefix.
  const chosen = scored
    .slice(0, MAX_SELECTED)
    .map((entry) => entry.pattern.id)
    .sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);

  // Dependencies come along whether or not they matched, and don't count against the cap:
  // a loft without hull_chain renders an empty file rather than failing.
  return chosen.length ? withDependencies(chosen) : [];
}

/**
 * The always-on index.
 *
 * Lives inside the cached system prompt. Its whole job is to make the agent aware that a
 * worked answer exists, so it asks for one instead of improvising — which is the failure
 * this library was built to prevent.
 */
export const PATTERN_INDEX = [
  "## Techniques you have worked, tested code for",
  "",
  "These are checked against a reference library before they ship, so the numbers in them are",
  "right. Where one covers what you're building, work from it rather than deriving your own —",
  "especially threads, gears, clearances and bearing fits, where an improvised answer renders",
  "something that looks correct and does not fit. Adapt them to the object: rename things, change",
  "the numbers, keep the geometry.",
  "",
  ...PATTERNS.map((pattern) => `- **${pattern.id}** — ${pattern.synopsis}`),
  "",
  "When one of these is relevant and its code was not included below, say so in your plan and",
  "build the shape from primitives instead. Never guess at a thread profile or a gear tooth.",
].join("\n");

/** The full text for the patterns picked this turn. Appended after the cached prefix. */
export function renderPatterns(patterns: ScadPattern[]): string {
  if (!patterns.length) return "";

  const sections = patterns.map((pattern) => {
    const parts = [`### ${pattern.id} — ${pattern.title}`, "", pattern.when];
    if (pattern.guidance) parts.push("", pattern.guidance);
    if (pattern.code) parts.push("", "```openscad", pattern.code, "```");
    if (pattern.usage) parts.push("", `Using it: ${pattern.usage}`);
    if (pattern.explain) parts.push("", `Explaining it, in their language: ${pattern.explain}`);
    return parts.join("\n");
  });

  return [
    "## Worked techniques for this build",
    "",
    "Relevant to what was just asked for. The code is tested — paste what you need into your",
    "program and adapt it. Drop the parts you don't use, rename things to suit the object, and",
    "change the numbers freely, but keep the geometry: it's the part that was verified.",
    "",
    "The {braces} in the explanations are yours to fill in with the real numbers.",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

/** Everything the prompt needs for one turn. */
export function patternBrief(input: SelectionInput): { text: string; ids: string[] } {
  const patterns = selectPatterns(input);
  return { text: renderPatterns(patterns), ids: patterns.map((pattern) => pattern.id) };
}
