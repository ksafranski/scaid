/**
 * The build as it was, each time it changed.
 *
 * Saving overwrites. That is the wrong shape for a tool whose whole argument is that a model
 * gets good by being changed: it keeps exactly one of the changes, and the one before the
 * change you regret is gone. Every other record of the work — the conversation, the steps —
 * describes versions that no longer exist anywhere.
 *
 * So each turn is kept, with what it measured alongside it. Keeping the measurements is what
 * makes the difference between two versions free to describe later: "a tenth heavier, 4mm
 * taller" is read off two records rather than by compiling anything.
 */
import type { Measured } from "./geometry/facts";

export interface Version {
  /** The program, exactly as it stood. */
  code: string;
  /** Why it changed: the agent's own summary, or that someone edited it. */
  label: string;
  /** What it measured, once it had. Null while it is still being built. */
  measured: Measured | null;
  /** Epoch milliseconds. */
  at: number;
}

/**
 * How many are kept.
 *
 * Enough to cover an afternoon's work and few enough that the whole history travels inside
 * one saved record without thought. A program is a couple of kilobytes; twenty-five of them
 * is smaller than one of the photos this app already stores.
 */
export const MAX_VERSIONS = 25;

/**
 * How close together two changes have to be before they count as one.
 *
 * Dragging a dial writes the program on every pause, so a single decision can land four or
 * five times in as many seconds. Those are one change to a person, and a history that says
 * otherwise is a history nobody scrolls. A turn from the agent is minutes from the last one
 * and is never swallowed by this.
 */
const COALESCE_MS = 12_000;

export const HAND_EDIT = "Edited by hand";

/**
 * The history with a change added to it.
 *
 * Pure, and returns a new list: what is kept is a decision worth being able to test on its
 * own, away from when the studio happens to call it.
 */
export function record(
  history: Version[],
  change: { code: string; label: string; at: number },
): Version[] {
  const newest = history[history.length - 1];

  // Nothing actually changed. A re-render of the same program is the same version.
  if (newest && newest.code === change.code) return history;

  const entry: Version = { ...change, measured: null };

  // A burst of edits is one change. The label of the burst is the first one's, because the
  // reason it started is more use than the reason it stopped.
  const coalesces =
    newest &&
    newest.label === change.label &&
    change.label === HAND_EDIT &&
    change.at - newest.at < COALESCE_MS;

  const next = coalesces
    ? [...history.slice(0, -1), { ...entry, at: newest.at }]
    : [...history, entry];

  return next.length > MAX_VERSIONS ? next.slice(next.length - MAX_VERSIONS) : next;
}

/** Fills in what a version measured, once the renderer has worked it out. */
export function measured(history: Version[], code: string, facts: Measured | null): Version[] {
  const newest = history[history.length - 1];
  if (!newest || newest.code !== code || newest.measured) return history;
  return [...history.slice(0, -1), { ...newest, measured: facts }];
}

/**
 * What changed between two versions, in the terms someone would notice.
 *
 * Read off the measurements both versions carry, so it costs nothing and cannot disagree
 * with what either of them said at the time. Only the things that moved are mentioned, and
 * only the two or three that moved most — a list of everything is a list nobody reads.
 */
export function describeChange(from: Measured | null, to: Measured | null): string {
  if (!from || !to) return "";

  // In order of what it costs someone to miss. A model that stopped closing won't print at
  // all, one that started needing support prints differently, and a few millimetres is a
  // few millimetres. Sorting by category rather than by size is the point: "6mm deeper" is
  // a bigger number than "needs support" and a far smaller piece of news.
  const parts: string[] = [];

  if (from.watertight && !to.watertight) parts.push("no longer closed");
  else if (!from.watertight && to.watertight) parts.push("closed now");

  if (from.overhangArea === 0 && to.overhangArea > 0) parts.push("now needs support");
  else if (from.overhangArea > 0 && to.overhangArea === 0) parts.push("needs no support");

  const axes: Array<{ change: number; grew: string; shrank: string }> = [
    { change: to.size.x - from.size.x, grew: "wider", shrank: "narrower" },
    { change: to.size.y - from.size.y, grew: "deeper", shrank: "shallower" },
    { change: to.size.z - from.size.z, grew: "taller", shrank: "shorter" },
  ];

  for (const axis of [...axes].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))) {
    if (Math.abs(axis.change) < 0.05) continue;
    parts.push(`${round(Math.abs(axis.change))}mm ${axis.change > 0 ? axis.grew : axis.shrank}`);
  }

  if (from.volume > 0 && to.volume > 0) {
    const ratio = (to.volume - from.volume) / from.volume;
    if (Math.abs(ratio) >= 0.02) {
      parts.push(`${Math.round(Math.abs(ratio) * 100)}% ${ratio > 0 ? "heavier" : "lighter"}`);
    }
  }

  if (!parts.length) return "Same size";

  // Three is as much as reads at a glance, and the rest is on the model to look at.
  const shown = parts.slice(0, 3).join(", ");
  return shown.charAt(0).toUpperCase() + shown.slice(1);
}

function round(value: number): string {
  return value < 10 ? String(Number(value.toFixed(1))) : String(Math.round(value));
}

/** "just now", "4 minutes ago" — a history is read by when, not by timestamp. */
export function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
