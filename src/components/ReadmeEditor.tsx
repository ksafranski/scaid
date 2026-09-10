"use client";

import { useState } from "react";
import { Eye, PencilSimple, type Icon } from "@phosphor-icons/react";
import { Markdown } from "./Markdown";

/** Roughly a dozen pages. Far more than a readme needs, and it has to fit in the record. */
export const MAX_README = 20_000;

const PLACEHOLDER = `# What I'm making

What it's for, and who it's for.

## The plan
- [ ] print a test piece
- [ ] check it fits

## Notes
Anything you want to remember next time.`;

/**
 * Somewhere to say what the project actually is.
 *
 * The conversation says what changed and the code says how, but neither says *why you're
 * building this* — the plan, the measurements you took off the real object, what to try
 * next. That's the person's own writing, so it isn't touched by the agent, and it leads
 * the spec document rather than sitting under it.
 *
 * Write and Preview rather than a split view: the panel is narrow and draggable, and two
 * columns inside it leaves neither wide enough to read.
 */
export function ReadmeEditor({
  readme,
  onChange,
}: {
  readme: string;
  onChange: (next: string) => void;
}) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const empty = !readme.trim();

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 px-5 pb-2.5">
        <div className="flex gap-1 rounded-lg bg-ink-900 p-1">
          <ModeButton active={mode === "write"} onClick={() => setMode("write")} Glyph={PencilSimple}>
            Write
          </ModeButton>
          <ModeButton active={mode === "preview"} onClick={() => setMode("preview")} Glyph={Eye}>
            Preview
          </ModeButton>
        </div>

        {/* The formatting that works, stated rather than discovered. Mirrors the legend
            over the code editor. */}
        <p className="hidden shrink-0 font-mono text-xs text-ink-500 sm:block">
          # heading · **bold** · - list
        </p>
      </div>

      <div className="mx-5 mb-5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-950">
        {mode === "write" ? (
          <textarea
            value={readme}
            onChange={(event) => onChange(event.target.value.slice(0, MAX_README))}
            spellCheck
            aria-label="Project readme, written in Markdown"
            placeholder={PLACEHOLDER}
            className="min-h-0 flex-1 resize-none bg-transparent p-4 text-[15px] leading-relaxed text-mist-100 outline-none placeholder:text-ink-500"
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {empty ? (
              <p className="text-sm text-ink-500">
                Nothing written yet. Switch to Write and say what you&apos;re making.
              </p>
            ) : (
              <Markdown source={readme} />
            )}
          </div>
        )}

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-ink-800 bg-ink-900 px-4 py-3">
          <span className="text-xs font-medium text-ink-500">
            {empty ? "Goes at the top of your spec document" : "Saved with this project"}
          </span>
          <span className="shrink-0 font-mono text-xs text-ink-500">
            {readme.length.toLocaleString()} / {MAX_README.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  Glyph,
  children,
}: {
  active: boolean;
  onClick: () => void;
  Glyph: Icon;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition ${
        active ? "bg-ink-700 text-mist-100" : "text-mist-500 hover:text-mist-300"
      }`}
    >
      <Glyph size={13} weight="duotone" className={active ? "text-volt-300" : undefined} />
      {children}
    </button>
  );
}
