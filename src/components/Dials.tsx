"use client";

import { useEffect, useRef, useState } from "react";
import { Sliders } from "@phosphor-icons/react";
import { Dropdown } from "./Dropdown";
import { groupParameters, type Parameter } from "@/lib/scadParameters";

/**
 * The model's own numbers, as things you can move.
 *
 * The point isn't only convenience. Dragging a wall thinner and watching the weight fall
 * and the balance give way teaches what the number does in a way that reading it never
 * will — so this sits beside the code rather than hiding it, and every move writes back
 * into the program where the number can be seen changing.
 */
export function Dials({
  parameters,
  onChange,
  disabled,
}: {
  parameters: Parameter[];
  /** Writes the new value into the program. */
  onChange: (name: string, value: number | boolean | string) => void;
  disabled?: boolean;
}) {
  if (!parameters.length) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-1 pb-6">
      <p className="flex items-center gap-1.5 pb-3 text-xs text-mist-500">
        <Sliders size={14} weight="duotone" className="shrink-0 text-volt-400" />
        Move one and the model rebuilds — the number changes in the code too.
      </p>

      <div className="flex flex-col gap-5">
        {groupParameters(parameters).map(({ group, parameters: within }) => (
          <div key={group ?? "__ungrouped"} className="flex flex-col gap-4">
            {group && (
              <p className="text-[10px] font-semibold tracking-[0.08em] text-mist-500 uppercase">
                {group}
              </p>
            )}
            {within.map((parameter) => (
              <Dial
                key={parameter.name}
                parameter={parameter}
                onChange={onChange}
                disabled={disabled}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Dial({
  parameter,
  onChange,
  disabled,
}: {
  parameter: Parameter;
  onChange: (name: string, value: number | boolean | string) => void;
  disabled?: boolean;
}) {
  if (parameter.kind === "boolean") {
    return (
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="text-sm text-mist-200">{parameter.label}</span>
        <input
          type="checkbox"
          checked={Boolean(parameter.value)}
          disabled={disabled}
          onChange={(event) => onChange(parameter.name, event.target.checked)}
          className="h-4 w-4 accent-volt-500"
        />
      </label>
    );
  }

  if (parameter.kind === "option" && parameter.options) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-mist-200">{parameter.label}</span>
        <Dropdown
          label={parameter.label}
          value={String(parameter.value)}
          options={parameter.options.map((option) => ({
            value: String(option.value),
            label: option.label,
          }))}
          onChange={(next) => {
            // Back to the type the program wrote, so a number stays a number.
            const original = parameter.options?.find((option) => String(option.value) === next);
            onChange(parameter.name, original ? original.value : next);
          }}
        />
      </div>
    );
  }

  return <NumberDial parameter={parameter} onChange={onChange} disabled={disabled} />;
}

/**
 * A number, as a slider when the program said what its range is and a box when it didn't.
 *
 * The reading follows the thumb immediately and the rebuild follows a moment behind it.
 * Every move recompiles the whole model — a quarter of a second for something simple and
 * a great deal longer for a swept form — so committing on every pixel of a drag would
 * queue up renders nobody asked to see.
 */
function NumberDial({
  parameter,
  onChange,
  disabled,
}: {
  parameter: Parameter;
  onChange: (name: string, value: number | boolean | string) => void;
  disabled?: boolean;
}) {
  const committed = Number(parameter.value);
  const [draft, setDraft] = useState(committed);
  const [seen, setSeen] = useState(committed);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The last value this dial asked for, so its own commit isn't mistaken for someone else's. */
  const [sent, setSent] = useState(committed);

  // The program is the truth: when it changes underneath — a rebuild, an edit in the code
  // panel, an undo — the dial follows it rather than holding a number nobody is dragging.
  //
  // But not when the change is this dial's own commit coming back. A drag sends a value
  // every couple of hundred milliseconds, and snapping the thumb back to the one that just
  // landed would fight the thumb still under the finger.
  if (committed !== seen) {
    setSeen(committed);
    if (committed !== sent) setDraft(committed);
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  function move(next: number) {
    setDraft(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setSent(next);
      onChange(parameter.name, next);
    }, 200);
  }

  const hasRange = parameter.min !== undefined && parameter.max !== undefined;
  const step = parameter.step ?? guessStep(parameter);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-mist-200">{parameter.label}</span>
        <span className="font-mono text-xs tabular-nums text-mist-400">{trim(draft)}</span>
      </div>

      {hasRange ? (
        <input
          type="range"
          min={parameter.min}
          max={parameter.max}
          step={step}
          value={draft}
          disabled={disabled}
          aria-label={parameter.label}
          onChange={(event) => move(Number(event.target.value))}
          className="w-full accent-volt-500"
        />
      ) : (
        <input
          type="number"
          step={step}
          value={draft}
          disabled={disabled}
          aria-label={parameter.label}
          onChange={(event) => {
            const next = Number(event.target.value);
            // A half-typed number is on its way somewhere; it isn't a value yet.
            if (event.target.value.trim() && Number.isFinite(next)) move(next);
            else setDraft(Number(event.target.value));
          }}
          className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm text-mist-100 focus:border-volt-500 focus:outline-none"
        />
      )}
    </div>
  );
}

/** A step fine enough to be useful over the range, when the program didn't pick one. */
function guessStep(parameter: Parameter): number {
  if (parameter.min === undefined || parameter.max === undefined) return 1;
  const span = parameter.max - parameter.min;
  if (span <= 5) return 0.1;
  if (span <= 50) return 0.5;
  return 1;
}

/** Drops the trailing zeros a slider's step leaves behind. */
function trim(value: number): string {
  return String(Number(value.toFixed(4)));
}
