"use client";

import { Eye, FileArrowUp, Warning } from "@phosphor-icons/react";
import { CopyBlock } from "./CopyBlock";
import type { ScadSource } from "@/hooks/useScadSource";

/** Where the Claude Code plugin lives — its own repo, so installing it doesn't clone Scaid. */
const MARKETPLACE = "ksafranski/claude-scad";

/**
 * What to do with an empty viewer, and what the thing is for.
 *
 * Written plugin-first, because that's the way in that costs nothing: Claude puts the
 * program in the URL and the model is simply there. Opening a file by hand is the second
 * path, kept for editors that aren't Claude, and said second because it's the one with a
 * dialog and a permission attached to it.
 */
export function ScadViewConnect({
  source,
  compact = false,
}: {
  source: ScadSource;
  /** Inside a working viewer, where the headline has already been earned. */
  compact?: boolean;
}) {
  const { watch, name } = source;

  return (
    <div className={compact ? "space-y-5" : "space-y-7"}>
      {!compact && (
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-semibold text-mist-100">
            Design in Claude Code, watch it here
          </h1>
          <p className="text-sm leading-relaxed text-mist-300">
            Ask Claude Code to build something and it lands in this tab — spin it, cut it open,
            measure it. No account, no upload, nothing stored: the program travels in the link
            itself, which is the one part of a URL a browser never sends to a server.
          </p>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-display text-sm font-semibold text-mist-100">Set it up once</h2>
        <p className="text-sm text-mist-300">
          Two commands in Claude Code, then{" "}
          <code className="font-mono text-xs text-mist-100">/scad-view</code> whenever you want
          to see what you&rsquo;re building.
        </p>
        <CopyBlock text={`/plugin marketplace add ${MARKETPLACE}\n/plugin install scad-view@claude-scad`} />
      </section>

      <section className="space-y-2.5 rounded-xl border border-ink-700 bg-ink-850 p-4">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-mist-100">
          <Eye size={15} weight="duotone" className="text-volt-300" />
          Editing by hand?
        </h2>
        <p className="text-sm leading-relaxed text-mist-300">
          {source.path
            ? "Claude refreshes this tab as it works. If you're also editing in your own editor, hand the file over and it'll rebuild on every save instead."
            : "Open a .scad yourself and this rebuilds it every time it's saved — useful when something other than Claude is doing the editing."}
        </p>

        <WatchButton watch={watch} name={name} />

        {watch.error && (
          <p className="flex items-start gap-2 text-sm text-amber-400">
            <Warning size={16} weight="duotone" className="mt-0.5 shrink-0" />
            {watch.error}
          </p>
        )}

        {watch.state === "unsupported" ? (
          <p className="text-xs leading-relaxed text-mist-500">
            Watching a file needs Chrome, Edge, Arc or Brave — Safari and Firefox haven&rsquo;t
            implemented it. Everything else on this page works in any browser.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-mist-500">
            Read-only, one file, and nothing else in the project is reachable from here.
          </p>
        )}
      </section>
    </div>
  );
}

function WatchButton({ watch, name }: { watch: ScadSource["watch"]; name: string | null }) {
  if (watch.state === "unsupported") return null;

  const label =
    watch.state === "needs-permission"
      ? `Reopen ${watch.name}`
      : watch.state === "watching"
        ? `Watching ${watch.name} — open a different file`
        : name
          ? `Watch ${name} for changes`
          : "Open a .scad file";

  return (
    <button
      onClick={watch.state === "needs-permission" ? watch.grant : watch.choose}
      className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-ink-600 px-4 py-2.5 text-sm font-semibold text-mist-100 transition hover:border-volt-500 hover:bg-ink-800"
    >
      <FileArrowUp size={16} weight="duotone" />
      {label}
    </button>
  );
}
