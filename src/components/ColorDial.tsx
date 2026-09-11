"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { CSS_COLOR_NAMES, byHue } from "@/lib/cssColors";

/**
 * Choosing a colour, from all of them.
 *
 * A colour setting arrives with whatever handful the agent listed beside it, which is a fine
 * starting point and a poor menu — the choice is between five when the program would accept
 * any of a hundred and forty. So the listed ones stay, first and marked as the suggestions
 * they are, and the rest of the names follow.
 *
 * Swatches rather than words. "mediumaquamarine" tells you almost nothing and a square of it
 * tells you everything, and the whole reason to reach for this is that you want to see.
 */
export function ColorDial({
  label,
  value,
  suggested,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  /** What the program listed, which is a hint about this model rather than a limit. */
  suggested: string[];
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Worked out the first time the grid is opened, not before. The browser is the only thing
  // that knows what these look like — and the only thing that agrees with OpenSCAD about it
  // — so the order comes from asking it a hundred and forty times, which is worth doing once
  // and worth not doing at all until someone wants to see the colours.
  const [ordered, setOrdered] = useState<string[] | null>(null);

  function show() {
    if (!ordered) setOrdered(hueOrder());
    setOpen((now) => !now);
  }

  // Suggestions first, then everything else, with nothing listed twice.
  const rest = (ordered ?? [...CSS_COLOR_NAMES]).filter((name) => !suggested.includes(name));

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5">
      <span className="text-sm text-mist-200">{label}</span>

      <button
        type="button"
        onClick={show}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm text-mist-100 transition hover:border-ink-600 disabled:opacity-50"
      >
        <Swatch name={value} size={16} />
        <span className="flex-1 truncate text-left">{value}</span>
        <CaretDown size={12} weight="bold" className="shrink-0 opacity-60" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="relative z-20 max-h-64 overflow-y-auto rounded-lg border border-ink-700 bg-ink-850 p-2.5 shadow-2xl"
        >
          {suggested.length > 0 && (
            <>
              <p className="pb-1.5 text-[10px] font-semibold tracking-[0.08em] text-mist-500 uppercase">
                Suggested
              </p>
              <Swatches names={suggested} value={value} onPick={(name) => { setOpen(false); onChange(name); }} />
              <p className="pt-3 pb-1.5 text-[10px] font-semibold tracking-[0.08em] text-mist-500 uppercase">
                Everything else
              </p>
            </>
          )}
          <Swatches names={rest} value={value} onPick={(name) => { setOpen(false); onChange(name); }} />
        </div>
      )}
    </div>
  );
}

/** The names in spectrum order, by asking the browser what each one looks like. */
function hueOrder(): string[] {
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return [...CSS_COLOR_NAMES];

  return byHue((name) => {
    probe.fillStyle = "#000000";
    probe.fillStyle = name;
    const hex = /^#([0-9a-f]{6})$/i.exec(probe.fillStyle);
    if (!hex) return null;
    const n = parseInt(hex[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  });
}

function Swatches({
  names,
  value,
  onPick,
}: {
  names: string[];
  value: string;
  onPick: (name: string) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(1.5rem,1fr))] gap-1">
      {names.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => onPick(name)}
          title={name}
          aria-label={name}
          aria-pressed={name === value}
          className={`aspect-square rounded transition ${
            name === value
              ? "ring-2 ring-volt-400 ring-offset-1 ring-offset-ink-850"
              : "hover:ring-1 hover:ring-mist-500"
          }`}
          style={{ backgroundColor: name }}
        />
      ))}
    </div>
  );
}

function Swatch({ name, size }: { name: string; size: number }) {
  return (
    <span
      aria-hidden
      className="shrink-0 rounded border border-ink-600"
      style={{ width: size, height: size, backgroundColor: name }}
    />
  );
}
