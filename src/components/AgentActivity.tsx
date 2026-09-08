"use client";

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
  notes: string[];
}

export const IDLE_ACTIVITY: Activity = {
  stage: "thinking",
  plan: null,
  name: null,
  parts: [],
  lines: 0,
  notes: [],
};

/** The headline for each phase. */
function headline(activity: Activity): string {
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
      // Before the first token there is genuinely nothing to report, and saying so plainly
      // beats inventing progress that hasn't happened.
      return "Thinking…";
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
  const title = headline(activity);
  const fixing = activity.stage === "fixing";

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
