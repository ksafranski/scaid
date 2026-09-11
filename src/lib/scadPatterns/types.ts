/**
 * A pattern is one modeling technique, written out in plain OpenSCAD.
 *
 * These exist because the design agent is good at deciding WHAT to build and unreliable at
 * deriving HOW when the geometry is genuinely hard. Asked for a threaded lid it will write
 * something thread-shaped and confidently wrong. Given a worked thread it will write a
 * threaded lid.
 *
 * Every pattern here is checked against BOSL2 — see scripts/verify-patterns.mjs. BOSL2 is
 * the reference, never a dependency: the code below has to stand on its own, because a
 * Scaid model is downloaded and opened in a plain OpenSCAD install with nothing installed
 * beside it.
 */

export type PatternFamily =
  /** Rounding, filleting, chamfering, hollowing — what makes a shape look made. */
  | "edges"
  /** Holes, clearances, overhangs — what makes it come off the printer right. */
  | "printability"
  /** Screws, tabs, snaps, hinges — what lets two parts become one object. */
  | "joinery"
  /** Threads, gears, bearings — the parts that have to mesh with the real world. */
  | "mechanical"
  /** Sweeps, lofts, spirals — getting from one profile to another. */
  | "form";

/** A rendered comparison that proves the pattern's code produces the solid it claims to. */
export interface PatternCheck {
  /** What this case is testing, for the failure message. */
  name: string;
  /** Calls into the pattern's modules. The pattern's `code` is prepended automatically. */
  subject: string;
  /**
   * A BOSL2 program that should describe the same solid. Omit when BOSL2 has no
   * equivalent — the check then only proves the pattern compiles and is watertight.
   */
  reference?: string;
  /** Allowed volume difference, as a percentage. Meshes differ; solids shouldn't. */
  tolerance?: number;
  /** Allowed bounding-box difference per axis, in millimeters. */
  sizeTolerance?: number;
  /** Outside dimensions the subject must hit, when there's no BOSL2 equivalent to compare. */
  expectSize?: [number, number, number];
}

export interface ScadPattern {
  /** Stable id. Shows up in the prompt, so keep it readable: "rounded-box", not "p17". */
  id: string;
  title: string;
  family: PatternFamily;
  /** One line for the always-on index. This is what the agent decides from, so be concrete. */
  synopsis: string;
  /** When to reach for it, and — just as usefully — when not to. */
  when: string;
  /**
   * Lowercased fragments matched against the request and the current code. A hit pulls the
   * full pattern into the prompt. Generous is fine: a pattern that shows up unneeded costs
   * a few hundred tokens, one that stays hidden costs a wrong model.
   */
  triggers: string[];
  /**
   * Ids of patterns whose modules this one calls.
   *
   * Without this a pattern looks fine in isolation and silently produces nothing in use:
   * OpenSCAD treats an undefined module as a warning and carries on, so a loft built on a
   * missing hull_chain renders an empty file rather than an error. Both the verifier and
   * the prompt builder pull these in.
   */
  requires?: string[];
  /**
   * Self-contained OpenSCAD, give or take anything named in `requires`. Module and function
   * definitions only — never top-level geometry, since this gets pasted into a larger program.
   */
  code?: string;
  /** How to call it and which numbers matter. */
  usage?: string;
  /** Numbers and rules that stand on their own, for patterns that are knowledge not code. */
  guidance?: string;
  /** Plain language the agent can adapt for the steps panel. No jargon. */
  explain?: string;
  /** Proof. Run by `npm run verify:patterns`. */
  checks?: PatternCheck[];
}
