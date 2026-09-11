import { PATTERN_SYMBOLS } from "@/lib/scadPatterns/index";

/**
 * Checks over generated OpenSCAD that don't need a compiler.
 *
 * The real reviewer is OpenSCAD itself, running in the browser — nothing here tries to
 * replace it. These are the handful of mistakes that are worth catching before the code
 * ever reaches the browser, because they're certain (a missing library will always fail)
 * and because catching them server-side saves a whole round trip through the renderer.
 *
 * Deliberately cheap and deterministic: no model call, no guessing. A check earns its place
 * only if a false positive is impossible.
 */

/** Something that will definitely fail to compile. Worth a repair pass before returning. */
export interface ScadProblem {
  /** What to hand the repair agent. Precise and technical — the model reads this. */
  detail: string;
  /** What to tell the person. Plain, brief, no jargon. */
  friendly: string;
}

/** Comments and string literals stripped, so a check can't fire on prose in a comment. */
function stripNonCode(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

export function findProblems(code: string): ScadProblem[] {
  const problems: ScadProblem[] = [];
  const source = stripNonCode(code);

  // include<> and use<> pull in libraries that aren't installed. The compiler reports this
  // as a plain "can't open file", which reads like a bug in Scaid rather than in the code.
  const imports = [...source.matchAll(/\b(include|use)\s*<([^>]*)>/g)];
  if (imports.length) {
    const names = [...new Set(imports.map((match) => match[2].trim()))].join(", ");
    problems.push({
      detail:
        `The code uses ${imports[0][1]}<> to pull in external libraries (${names}). No libraries ` +
        `are installed, so this fails to compile. Rewrite using only built-in OpenSCAD features.`,
      friendly: "It reached for a parts library that isn't installed, so I rebuilt it from scratch.",
    });
  }

  // A pattern that was called but never pasted in.
  //
  // This is the nastiest failure mode there is, because it isn't one: OpenSCAD downgrades an
  // unknown module to a warning and renders on, so a program missing the module that does all
  // the work comes back as a valid, empty file. Nothing errors and nothing appears.
  const defined = new Set(
    [...source.matchAll(/\b(?:module|function)\s+([A-Za-z_]\w*)/g)].map((match) => match[1]),
  );
  const assigned = new Set(
    [...source.matchAll(/(?:^|[;{}])\s*([A-Za-z_]\w*)\s*=(?!=)/gm)].map((match) => match[1]),
  );
  const missing = PATTERN_SYMBOLS.filter((name) => {
    if (defined.has(name) || assigned.has(name)) return false;
    // A constant is read bare; a module or function is always called.
    const used =
      name === name.toUpperCase()
        ? new RegExp(`\\b${name}\\b`).test(source)
        : new RegExp(`\\b${name}\\s*\\(`).test(source);
    return used;
  });
  if (missing.length) {
    problems.push({
      detail:
        `The code calls ${missing.join(", ")} but never defines ${missing.length === 1 ? "it" : "them"}. ` +
        `OpenSCAD treats an unknown module as a warning and renders an empty file, so this ` +
        `produces no geometry at all. Paste the missing definitions into the program.`,
      friendly: "Part of the recipe was missing, so I filled it back in.",
    });
  }

  // A markdown fence that survived stripping is a syntax error on line 1.
  if (/^\s*```/.test(code)) {
    problems.push({
      detail: "The code begins with a markdown code fence. Emit OpenSCAD source only.",
      friendly: "There was some stray formatting at the top of the code.",
    });
  }

  return problems;
}

/**
 * Notes worth showing but not worth a repair pass — the model made a defensible choice that
 * has a cost the person should know about.
 */
export function findAdvice(code: string): string[] {
  const advice: string[] = [];
  const source = stripNonCode(code);

  // A sweep pays for its primitive's resolution once per step, so a few hundred beads at the
  // global $fn is the single most common reason a build takes half a minute to appear. One
  // $fn in the whole file means nothing was given a cheaper local one.
  const sweeps = /\bfor\s*\(/.test(source) && /\bhull\s*\(/.test(source);
  // Any $fn assignment counts as an override, including `$fn = detail` passed through a
  // parameter — only the digits are read for the global, but a named one is still a choice.
  const overrides = [...source.matchAll(/\$fn\s*=/g)];
  const global = /\$fn\s*=\s*(\d+)/.exec(source);
  if (sweeps && overrides.length === 1 && global && Number(global[1]) >= 32) {
    advice.push(
      "This one is swept from a lot of small pieces, and each is drawn at full smoothness — " +
        "that's why it took a while to appear. Ask me to make the pieces coarser and it'll " +
        "show up far faster without looking any different.",
    );
  }

  const resolution = /\$fn\s*=\s*(\d+)/.exec(source);
  if (!resolution) {
    advice.push("No smoothness setting, so curves will look chunky. Ask me to smooth it out.");
  } else if (Number(resolution[1]) > 100) {
    advice.push(`Smoothness is set to ${resolution[1]}, which looks great but renders slowly.`);
  }

  return advice;
}
