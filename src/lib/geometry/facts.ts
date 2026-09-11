/**
 * Measurements turned into words, in one place.
 *
 * The same facts are read by three audiences — the person, the write-up, and the design
 * agent — and they have to agree. The agent in particular will quote these numbers back,
 * so anything hedged here has to stay hedged there: a weight stated as fact would be wrong
 * on every print anyone makes.
 */
import { estimateMaterial } from "./materials";
import type { GeometryReport } from "./inspect";

/**
 * The wire shape: what the browser sends the design agent about the last build.
 *
 * Every field is a bounded number or a boolean, and the sentences are written on the
 * server from these. Nothing the browser types travels into the prompt, so this can't
 * become a way to say something to the agent that the person didn't say.
 */
export interface Measured {
  size: { x: number; y: number; z: number };
  volume: number;
  area: number;
  centroid: { x: number; y: number; z: number } | null;
  watertight: boolean;
  openEdges: number;
  overhangArea: number;
  overhangFraction: number;
  steepestOverhangDeg: number;
  contactArea: number;
  tipMarginMm: number | null;
}

export function toMeasured(report: GeometryReport): Measured | null {
  if (report.empty) return null;
  return {
    size: report.size,
    volume: report.volume,
    area: report.area,
    centroid: report.centroid,
    watertight: report.watertight.ok,
    openEdges: report.watertight.openEdges,
    overhangArea: report.overhang.area,
    overhangFraction: report.overhang.fraction,
    steepestOverhangDeg: report.overhang.steepestDeg,
    contactArea: report.bed.contactArea,
    tipMarginMm: report.bed.tipMargin,
  };
}

const round = (value: number) => (value < 10 ? value.toFixed(1) : String(Math.round(value)));
const whole = (value: number) => Math.round(value).toLocaleString("en-US");

/** One measured fact, in the shape the spec document already renders. */
export interface FactRow {
  label: string;
  value: string;
  /** Set when the number is a problem rather than just a fact. */
  warn?: boolean;
}

/**
 * The facts as rows, for the readout and the write-up.
 *
 * Volume and everything derived from it are omitted outright when the surface doesn't
 * close. On a shape with a hole in it the figure is the volume of an arbitrary patch over
 * that hole — a real number about nothing — and showing it with a caveat beside it would
 * still leave the number on screen to be read.
 */
export function factRows(report: GeometryReport): FactRow[] {
  if (report.empty) return [];

  const rows: FactRow[] = [];
  const closed = report.watertight.ok;

  if (closed) {
    const { grams, filamentMm } = estimateMaterial(report.volume);
    rows.push({ label: "Volume", value: `${whole(report.volume)} mm³` });
    rows.push({ label: "Weight", value: `${grams.toFixed(1)} g if printed solid` });
    rows.push({ label: "Filament", value: `${(filamentMm / 1000).toFixed(2)} m if printed solid` });
  }

  rows.push({ label: "Surface", value: `${whole(report.area)} mm²` });

  rows.push(
    closed
      ? { label: "Solid", value: "Closed all the way round" }
      : {
          label: "Solid",
          value: report.watertight.skipped
            ? "Too big to check"
            : describeDefect(report),
          warn: !report.watertight.skipped,
        },
  );

  rows.push({
    label: "Overhangs",
    value:
      report.overhang.area > 0
        ? `${whole(report.overhang.area)} mm² past ${report.overhang.thresholdDeg}°, steepest ${Math.round(report.overhang.steepestDeg)}°`
        : "None — it prints without support",
  });

  rows.push({ label: "Sits on", value: `${whole(report.bed.contactArea)} mm² of plate` });

  if (report.bed.balancesOnAPoint) {
    rows.push({ label: "Balance", value: "Touches the plate on a single line — it won't stand", warn: true });
  } else if (report.bed.tipMargin !== null) {
    rows.push(
      report.bed.tipMargin > 0
        ? {
            label: "Balance",
            value: `${round(report.bed.tipMargin)} mm inside its footprint${
              report.bed.tipAngleDeg !== null ? ` — tips at ${Math.round(report.bed.tipAngleDeg)}°` : ""
            }`,
          }
        : { label: "Balance", value: "Outside its footprint — it falls over", warn: true },
    );
  }

  return rows;
}

/** What's wrong with the surface, in shapes rather than in mesh vocabulary. */
function describeDefect(report: GeometryReport): string {
  const { openEdges, nonManifoldEdges, flippedEdges, inverted } = report.watertight;
  if (openEdges > 0) {
    return `It has ${openEdges === 1 ? "a gap" : `${openEdges} gaps`} in its surface`;
  }
  if (inverted) return "It's inside out";
  if (flippedEdges > 0) return "Part of its surface faces the wrong way";
  if (nonManifoldEdges > 0) return "It crosses through itself";
  return "It isn't closed";
}

/**
 * The block handed to the design agent.
 *
 * "The last build that rendered" is exact and deliberate. The renderer keeps the last good
 * model on screen when a render fails, so after a broken hand-edit these numbers describe
 * the previous build rather than the code in the message — and an agent told otherwise
 * would confidently reason about a shape that doesn't exist.
 */
export function describeMeasurements(measured: Measured, plateSizeMm?: number): string {
  const lines: string[] = [];
  const m = measured;

  lines.push(
    `- Outside size ${round(m.size.x)} x ${round(m.size.y)} x ${round(m.size.z)} mm` +
      (plateSizeMm ? `, on a ${plateSizeMm} mm plate` : ""),
  );

  if (m.watertight) {
    const { grams } = estimateMaterial(m.volume);
    lines.push(
      `- Volume ${whole(m.volume)} mm3, surface ${whole(m.area)} mm2` +
        ` (about ${grams.toFixed(1)} g if it were printed solid, which no print is)`,
    );
    lines.push("- Closed all the way round");
  } else {
    lines.push(
      `- NOT closed: ${m.openEdges} edges have nothing on the other side, so it has holes in it. ` +
        `The volume can't be measured and the STL download is broken until this is fixed.`,
    );
  }

  lines.push(
    m.overhangArea > 0
      ? `- ${whole(m.overhangArea)} mm2 of surface, ${(m.overhangFraction * 100).toFixed(1)}% of it, ` +
        `faces downward more steeply than 45 degrees; the worst is ${Math.round(m.steepestOverhangDeg)} degrees`
      : "- Nothing overhangs past 45 degrees, so it prints without support",
  );

  if (m.tipMarginMm === null) {
    lines.push(`- It touches the plate over ${whole(m.contactArea)} mm2, on a point or a single line`);
  } else if (m.tipMarginMm > 0) {
    lines.push(
      `- It sits on the plate over ${whole(m.contactArea)} mm2, with its balance point ` +
        `${round(m.tipMarginMm)} mm inside that footprint`,
    );
  } else {
    lines.push(
      `- Its balance point falls OUTSIDE the ${whole(m.contactArea)} mm2 it touches the plate over, ` +
        `so it topples over as it stands`,
    );
  }

  return `What the last build that rendered actually measured, taken off the mesh itself:\n${lines.join("\n")}`;
}

/**
 * The one thing about this model worth interrupting someone over, or null.
 *
 * Kept to defects that are certain and that they'd otherwise find out the slow way: a
 * surface that isn't closed silently breaks the download, and a model whose balance point
 * falls outside its footprint falls over.
 *
 * Deliberately says nothing about overhangs. Plenty of good models need support, so a
 * warning about it would appear on a large share of builds — and a channel that speaks up
 * half the time is one people learn to stop reading.
 */
export function factProblem(report: GeometryReport): string | null {
  if (report.empty) return null;

  if (!report.watertight.ok && !report.watertight.skipped) {
    return (
      `${describeDefect(report)}, which means it isn't a solid object yet — the STL download ` +
      `would come out broken. Ask me to close it up.`
    );
  }

  if (report.bed.balancesOnAPoint) {
    return (
      "It only touches the plate along a single line, so it has nothing to hold it upright " +
      "while it prints. Ask me to give it a flat base."
    );
  }

  if (report.bed.tipMargin !== null && report.bed.tipMargin <= 0) {
    return (
      "Its balance point sits outside the part touching the plate, so it topples over. " +
      "Ask me to widen the base or move the weight back over it."
    );
  }

  return null;
}
