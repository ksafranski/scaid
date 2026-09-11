"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown, ClockCounterClockwise } from "@phosphor-icons/react";
import { ago, describeChange, type Version } from "@/lib/versions";

/**
 * The build as it was, each time it changed.
 *
 * Newest first, because the thing someone is looking for is almost always recent — "put back
 * what I had before that last change" rather than an archaeology of the afternoon.
 *
 * Each row says what changed to produce it, measured against the one before: the difference
 * is read off two sets of measurements that were taken at the time, so it costs nothing and
 * can't disagree with what either version said when it was current.
 */
export function History({
  versions,
  currentCode,
  onRestore,
}: {
  versions: Version[];
  /** So the one on screen can be marked rather than offered as somewhere to go. */
  currentCode: string;
  onRestore: (version: Version) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;

    // "just now" stops being true while the list is sitting open. The clock is read when
    // it opens, so this only has to keep it honest from there.
    const tick = setInterval(() => setNow(Date.now()), 30_000);

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearInterval(tick);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // One version is the build as it stands, and a history of the present is not a history.
  if (versions.length < 2) return null;

  const newestFirst = [...versions].reverse();

  // Putting an earlier version back leaves two entries holding the same program, and both
  // of them match what's on screen. Only the newest is where you actually are; marking the
  // other one too would offer to put back something you are already looking at.
  const onScreen = newestFirst.findIndex((version) => version.code === currentCode);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => {
          setNow(Date.now());
          setOpen((value) => !value);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Every version of this build"
        className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs text-mist-500 transition hover:bg-ink-800 hover:text-mist-300"
      >
        <ClockCounterClockwise size={13} weight="duotone" className="shrink-0" />
        <span className="font-medium">History</span>
        <span className="font-mono">{versions.length}</span>
        <CaretDown size={10} weight="bold" className="opacity-60" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Every version of this build"
          className="absolute right-0 z-30 mt-1.5 max-h-[26rem] w-80 overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 p-1 shadow-2xl"
        >
          <ul className="divide-y divide-ink-800">
            {newestFirst.map((version, index) => {
              // What this version changed: itself against the one before it in time.
              const previous = newestFirst[index + 1];
              const change = describeChange(previous?.measured ?? null, version.measured);
              const isCurrent = index === onScreen;

              return (
                <li key={`${version.at}-${index}`} className="px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs font-semibold text-mist-500">
                      {ago(version.at, now)}
                    </span>
                    {isCurrent ? (
                      <span className="text-[10px] font-semibold tracking-wide text-volt-300 uppercase">
                        On screen
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setOpen(false);
                          onRestore(version);
                        }}
                        className="rounded-md border border-ink-600 px-2 py-0.5 text-[11px] font-semibold text-mist-300 transition hover:bg-ink-700 hover:text-mist-100"
                      >
                        Put this back
                      </button>
                    )}
                  </div>

                  <p className="mt-1 text-xs leading-relaxed text-mist-200">{version.label}</p>
                  {change && <p className="mt-0.5 text-xs text-mist-500">{change}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
