/**
 * What the agent said the thing would be, checked against what it is.
 *
 * The measurements tell the agent what it built. They don't make it right. It can say a lid
 * is 40mm across, build one 43mm across, describe it as 40mm in the summary, and nothing
 * anywhere disagrees — the person finds out when it doesn't fit.
 *
 * So a build states the handful of numbers it is committing to, before writing the code,
 * and those are checked against the mesh that came out. A miss is handled the way a build
 * error already is: the agent wrote it, so the agent fixes it.
 *
 * Only things that can actually be measured are allowed to be claimed. Wall thickness and
 * hole diameter are the two most worth checking and neither can be, yet — they need a ray
 * cast that doesn't exist here. They are left out rather than approximated, because a check
 * that can't fail is worse than no check: it reads as verification and isn't.
 */
import type { GeometryReport } from "./inspect";

/** The measurements a claim may be made about. Every one of these is really measured. */
export const MEASURABLES = ["width", "depth", "height", "volume"] as const;

export type Measurable = (typeof MEASURABLES)[number];

export interface Expectation {
  /** What it is, in the person's terms: "the outside across the top". */
  what: string;
  measure: Measurable;
  /** Millimeters, or cubic millimeters for volume. */
  value: number;
  /** How far out it may be and still count. Same unit as the value. */
  tolerance: number;
}

export interface ExpectationResult {
  expectation: Expectation;
  /** What came out, in the same unit. Null when it couldn't be measured. */
  actual: number | null;
  ok: boolean;
  /** Why it wasn't checked, when it wasn't. */
  skipped?: string;
}

/** The unit a measure is quoted in, for saying it out loud. */
const UNIT: Record<Measurable, string> = {
  width: "mm",
  depth: "mm",
  height: "mm",
  volume: "mm³",
};

function actualOf(measure: Measurable, report: GeometryReport): number | null {
  switch (measure) {
    case "width":
      return report.size.x;
    case "depth":
      return report.size.y;
    case "height":
      return report.size.z;
    case "volume":
      // On a shape that doesn't close, the volume is the volume of an arbitrary patch over
      // the hole. Failing a claim against that would be blaming the wrong thing.
      return report.watertight.ok ? report.volume : null;
  }
}

export function checkExpectations(
  expectations: Expectation[],
  report: GeometryReport,
): ExpectationResult[] {
  if (report.empty) return [];

  return expectations.map((expectation) => {
    const actual = actualOf(expectation.measure, report);
    if (actual === null) {
      return {
        expectation,
        actual: null,
        ok: true,
        skipped: "the shape isn't closed, so there's no volume to compare",
      };
    }

    // A claim that nothing could fail is not a claim. Rather than quietly passing it, it's
    // treated as not having been checked, so it can't be mistaken for verification.
    if (!(expectation.tolerance > 0) || expectation.tolerance >= Math.abs(expectation.value)) {
      return { expectation, actual, ok: true, skipped: "no real tolerance was given" };
    }

    return {
      expectation,
      actual,
      ok: Math.abs(actual - expectation.value) <= expectation.tolerance,
    };
  });
}

export function misses(results: ExpectationResult[]): ExpectationResult[] {
  return results.filter((result) => !result.ok && result.actual !== null);
}

const round = (value: number) => (value < 10 ? value.toFixed(2) : String(Math.round(value)));

/**
 * The fault, written for the repair pass.
 *
 * Precise and mechanical on purpose: this one is read by a model being asked to change one
 * thing, so it says which number, what was promised, and what came out.
 */
export function describeMisses(results: ExpectationResult[]): string {
  const lines = misses(results).map(({ expectation, actual }) => {
    const unit = UNIT[expectation.measure];
    return (
      `- ${expectation.what}: you said the ${expectation.measure} would be ` +
      `${round(expectation.value)}${unit} (within ${round(expectation.tolerance)}${unit}), ` +
      `and the model measures ${round(actual as number)}${unit}.`
    );
  });

  return (
    `The model builds, but it isn't the size you said it would be. Measured off the mesh:\n` +
    `${lines.join("\n")}\n\n` +
    `Change the sizes so the model matches what you said, and change nothing else.`
  );
}

/** The same thing said to the person, who wants to know whether it matters. */
export function summariseMisses(results: ExpectationResult[]): string {
  const missed = misses(results);
  if (!missed.length) return "";

  const first = missed[0];
  const unit = UNIT[first.expectation.measure];
  const rest = missed.length - 1;

  return (
    `I said ${first.expectation.what} would be ${round(first.expectation.value)}${unit}, ` +
    `and it came out ${round(first.actual as number)}${unit}` +
    (rest > 0 ? `, and ${rest} other ${rest === 1 ? "size is" : "sizes are"} off too.` : ".")
  );
}
