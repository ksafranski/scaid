"use client";

import type { ReactNode } from "react";
import { CircleNotch } from "@phosphor-icons/react";

/**
 * The one way the app says "this is happening".
 *
 * Waiting is most of what this app does — a build runs for half a minute, a render for a
 * second or two, an export for longer. Before this file those waits were reported four
 * different ways: a swept gradient in the agent panel, a plain grey line over the viewer, a
 * pulsing dot in the editor toolbar, and bare text inside a button. Same event, four
 * vocabularies, so none of them read as "the app is working" on sight.
 *
 * Everything in here sweeps. The gradient is the signal; the spinner or dot beside it is
 * just scale. An eslint rule keeps `animate-sweep` and `animate-spin` inside this file, so
 * the next loading state has to come through one of these rather than inventing a fifth look.
 *
 * The sweep sets `color: transparent` and clips its gradient to the glyphs, which is why the
 * text always gets its own span: put it on a container and `background-clip` takes that
 * container's own background with it. Under `prefers-reduced-motion` the gradient drops and
 * the text resolves to mist-300 — see `.animate-sweep` in globals.css.
 */
export function WorkingText({
  children,
  className = "",
}: {
  children: ReactNode;
  /** Type styles only. Color is the sweep's, and setting it here would do nothing. */
  className?: string;
}) {
  return <span className={`animate-sweep ${className}`.trim()}>{children}</span>;
}

/**
 * A spinner and a label, sitting in the flow of whatever contains it.
 *
 * For a wait that owns its space — an empty panel that hasn't got anything to show yet.
 */
export function WorkingLine({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-2.5 text-sm ${className}`.trim()}>
      <CircleNotch size={16} weight="bold" className="shrink-0 animate-spin text-volt-300" />
      <WorkingText>{label}</WorkingText>
    </span>
  );
}

/**
 * The same message floated over the model in its own panel.
 *
 * Expects a positioned ancestor. Deliberately `pointer-events-none`: the model underneath
 * stays draggable while this sits on top of it.
 */
export function WorkingOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="flex items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-850/90 px-5 py-3 text-sm font-medium backdrop-blur">
        <CircleNotch size={16} weight="bold" className="animate-spin text-volt-300" />
        <WorkingText>{label}</WorkingText>
      </div>
    </div>
  );
}

/**
 * A pulsing dot rather than a spinner, for a status that shares a crowded strip.
 *
 * A spinner at toolbar scale reads as clutter next to buttons; a dot carries the same
 * meaning at a fraction of the visual weight.
 */
export function WorkingDot({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-2 text-xs font-medium ${className}`.trim()}>
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-volt-400" />
      <WorkingText>{label}</WorkingText>
    </span>
  );
}
