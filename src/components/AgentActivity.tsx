"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Stop, Wrench } from "@phosphor-icons/react";
import { StepIcon } from "./StepIcon";
import type { AgentStage } from "@/lib/agentEvents";
import type { IconName } from "@/lib/iconNames";

/** Everything the studio has learned about the build in progress. */
export interface Activity {
  stage: AgentStage;
  /** The one-line approach, in the model's own words. */
  plan: string | null;
  name: string | null;
  parts: Array<{ icon: IconName; title: string }>;
  /** Lines of code written so far, counted from the stream. */
  lines: number;
  /** The latest line of reasoning, shown only while there's nothing better to show. */
  thought: string | null;
  notes: string[];
}

export const IDLE_ACTIVITY: Activity = {
  stage: "thinking",
  plan: null,
  name: null,
  parts: [],
  lines: 0,
  thought: null,
  notes: [],
};

/**
 * Seconds since the build started, while it's still in the phase that shows nothing else.
 *
 * The thinking phase is the long one — measured at 49 seconds of a 70 second build on a
 * complex request with a picture, better than two thirds of the wait — and until now it
 * looked exactly like a hang. A number that moves is the difference between "working" and
 * "stuck", and it's the only honest thing there is to report before the first token.
 */
function useElapsedSeconds(counting: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!counting) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [counting]);

  return seconds;
}

/** The headline for each phase. */
function headline(activity: Activity, seconds: number): string {
  switch (activity.stage) {
    case "parts":
      return activity.parts.length ? "Working out the parts" : "Planning the build";
    case "writing":
      return activity.lines > 0 ? `Writing the code · ${activity.lines} lines` : "Writing the code";
    case "checking":
      return "Checking it builds";
    case "fixing":
      return "Fixing a problem";
    default:
      // Before the first token there is genuinely nothing to report except how long it has
      // been, so that's what gets reported. Held back for a few seconds so a quick turn
      // doesn't flash a counter on its way past.
      return seconds >= 3 ? `Thinking… ${seconds}s` : "Thinking…";
  }
}

/**
 * What Scaid is doing, while it does it.
 *
 * Every line here comes from the model's own output as it streams — the approach, then each
 * part as it's named, then the code as it's written. Nothing is invented.
 */
export function AgentActivity({
  activity,
  onStop,
}: {
  activity: Activity;
  /** Calls the build off. Sits here because this is where the work is being reported. */
  onStop: () => void;
}) {
  const fixing = activity.stage === "fixing";
  const seconds = useElapsedSeconds(activity.stage === "thinking");
  const title = headline(activity, seconds);

  return (
    <div className="animate-rise space-y-3 rounded-xl border border-ink-700 bg-ink-800 px-4 py-3.5">
      <div className="flex items-center gap-3">
        {fixing ? (
          <Wrench size={16} weight="duotone" className="shrink-0 animate-pulse text-amber-400" />
        ) : (
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-volt-400" />
        )}
        {/* The sweep says work is happening, so the resting color only applies when it isn't. */}
        <span className="animate-sweep flex-1 text-sm font-medium">{title}</span>

        <button
          onClick={onStop}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1 text-xs font-semibold text-mist-500 transition hover:border-ink-600 hover:bg-ink-700 hover:text-mist-100"
        >
          <Stop size={12} weight="fill" />
          Stop
        </button>
      </div>

      {activity.stage === "thinking" && activity.thought && (
        // Replaced as the reasoning moves on, and gone the moment the plan arrives — this is
        // what fills the wait, not a record worth keeping.
        <p className="border-l-2 border-ink-700 pl-3 text-sm leading-relaxed text-mist-500">
          {activity.thought}
        </p>
      )}

      {activity.plan && (
        <p className="border-l-2 border-ink-700 pl-3 text-sm leading-relaxed text-mist-400">
          {activity.plan}
        </p>
      )}

      {activity.parts.length > 0 && (
        <ul className="space-y-1.5">
          {activity.parts.map((part, index) => (
            <li key={index} className="animate-rise flex items-center gap-2.5">
              <StepIcon name={part.icon} size={17} />
              <span className="flex-1 text-sm text-mist-300">{part.title}</span>
              <CheckCircle size={15} weight="duotone" className="shrink-0 text-emerald-400" />
            </li>
          ))}
        </ul>
      )}

      {activity.notes.map((note, index) => (
        <p key={index} className="text-sm leading-relaxed text-mist-300">
          {note}
        </p>
      ))}
    </div>
  );
}
