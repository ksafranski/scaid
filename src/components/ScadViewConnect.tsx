"use client";

import { FileArrowUp, Lightning, Warning } from "@phosphor-icons/react";
import { CopyBlock } from "./CopyBlock";
import type { Watching } from "@/hooks/useWatchedFile";

/** Where the Claude Code plugin lives. The repo is its own marketplace. */
const MARKETPLACE = "ksafranski/scaid";

/**
 * The way in: open one `.scad`, and every save to it rebuilds here.
 *
 * Shown while nothing is being watched, and again behind a button afterwards — the moment
 * you want to read this is usually the moment the model *isn't* updating, which is exactly
 * when it has scrolled out of your life.
 */
export function ScadViewConnect({
  state,
  name,
  wanted,
  error,
  onChoose,
  onGrant,
  compact = false,
}: {
  state: Watching;
  /** What's currently open, if anything. */
  name: string | null;
  /** What the URL asked for — the file the plugin says you're working on. */
  wanted: string | null;
  error: string | null;
  onChoose: () => void;
  onGrant: () => void;
  compact?: boolean;
}) {
  if (state === "unsupported") return <Unsupported />;

  const target = wanted ?? "a .scad file";

  return (
    <div className={compact ? "space-y-5" : "space-y-7"}>
      {!compact && (
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-semibold text-mist-100">
            Open a file, watch it build
          </h1>
          <p className="text-sm leading-relaxed text-mist-300">
            {wanted ? (
              <>
                Open <code className="rounded bg-ink-800 px-1 py-0.5 font-mono text-xs">{wanted}</code>{" "}
                and it builds here — spin it, cut it open, measure it — and it rebuilds every
                time it&rsquo;s saved.
              </>
            ) : (
              <>
                Open the{" "}
                <code className="rounded bg-ink-800 px-1 py-0.5 font-mono text-xs">.scad</code> you
                are working on and it builds here — spin it, cut it open, measure it — and it
                rebuilds every time it&rsquo;s saved.
              </>
            )}
          </p>
        </div>
      )}

      {state === "needs-permission" ? (
        <div className="space-y-3">
          <button
            onClick={onGrant}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-volt-500 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-volt-600"
          >
            <FileArrowUp size={18} weight="duotone" />
            Reopen {name}
          </button>
          <p className="text-xs leading-relaxed text-mist-500">
            Your browser asks again each time this page loads. Choosing &ldquo;allow on every
            visit&rdquo; in that prompt makes this one-click next time.
          </p>
        </div>
      ) : (
        <button
          onClick={onChoose}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-volt-500 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-volt-600"
        >
          <FileArrowUp size={18} weight="duotone" />
          {name ? "Open a different file" : `Open ${target}`}
        </button>
      )}

      {error && (
        <p className="flex items-start gap-2 text-sm text-amber-400">
          <Warning size={16} weight="duotone" className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <ul className="space-y-2.5 text-sm text-mist-300">
        <Point>
          One file, not a folder. The page can only ever see the{" "}
          <code className="font-mono text-xs text-mist-100">.scad</code> you hand it — nothing
          else in the project is reachable from here.
        </Point>
        <Point>
          Nothing is uploaded. It&rsquo;s read off your disk directly, so no account, no
          server, and no copy of your work anywhere but your machine.
        </Point>
        <Point>Read-only, so nothing here can edit or overwrite what you&rsquo;re working on.</Point>
      </ul>

      <div className="space-y-2 rounded-xl border border-ink-700 bg-ink-850 p-4">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-mist-100">
          <Lightning size={15} weight="duotone" className="text-volt-300" />
          Designing with Claude Code?
        </h2>
        <p className="text-sm leading-relaxed text-mist-300">
          A plugin adds a <code className="font-mono text-xs text-mist-100">/scad-view</code>{" "}
          command that opens this on whichever file you&rsquo;re working on, and remembers it so
          the next time is one click.
        </p>
        <CopyBlock text={`/plugin marketplace add ${MARKETPLACE}\n/plugin install scad-view@scaid`} />
      </div>
    </div>
  );
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 leading-relaxed">
      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-volt-400" />
      <span>{children}</span>
    </li>
  );
}

/**
 * Firefox and Safari have no way to hand a page a file it can keep watching, and there's no
 * polyfill for it — so this says which browsers work rather than failing at the dialog.
 */
function Unsupported() {
  return (
    <div className="space-y-3">
      <h1 className="font-display text-xl font-semibold text-mist-100">
        This one needs a Chromium browser
      </h1>
      <p className="text-sm leading-relaxed text-mist-300">
        Keeping hold of a file so a page can watch it for changes is only possible in Chrome,
        Edge, Arc, Brave and friends. Safari and Firefox haven&rsquo;t implemented it, and
        there&rsquo;s nothing this page can do to work around that.
      </p>
      <p className="text-sm leading-relaxed text-mist-300">
        Open this URL in one of those and it&rsquo;ll work. The rest of Scaid is fine in every
        browser — it&rsquo;s only the live view that needs this.
      </p>
    </div>
  );
}
