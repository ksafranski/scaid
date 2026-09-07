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

  const resolution = /\$fn\s*=\s*(\d+)/.exec(source);
  if (!resolution) {
    advice.push("No smoothness setting, so curves will look chunky. Ask me to smooth it out.");
  } else if (Number(resolution[1]) > 100) {
    advice.push(`Smoothness is set to ${resolution[1]}, which looks great but renders slowly.`);
  }

  return advice;
}
