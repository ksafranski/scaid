"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { FileCode, FolderOpen, Question, X } from "@phosphor-icons/react";
import { CodeEditor } from "./CodeEditor";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { Logo } from "./Logo";
import { ModelViewer } from "./ModelViewer";
import { PlateSizePicker } from "./PrintControls";
import { ScadViewConnect } from "./ScadViewConnect";
import { WorkingOverlay } from "./Working";
import { useScadRenderer } from "@/hooks/useScadRenderer";
import { useWatchedScad } from "@/hooks/useWatchedScad";
import { usePanelWidth } from "@/hooks/usePanelWidth";
import { useBrowserOnly } from "@/hooks/useBrowserOnly";
import { DEFAULT_SETTINGS, normalizePlateSize } from "@/lib/types";

const PLATE_KEY = "scaid.scadView.plateSizeMm";
/** Its own width, not the studio's — see usePanelWidth for why they're kept apart. */
const WIDTH_KEY = "scaid.scadView.panelWidth";

/** The dropdown value meaning "whichever file was edited last", which is the default. */
const NEWEST = "";

/** The longest project path worth keying storage on, so a junk query string can't fill it. */
const MAX_KEY = 512;

/**
 * Which project this tab belongs to, from the `?dir=` the plugin put in the URL.
 *
 * Read once and cached, because `useSyncExternalStore` compares snapshots by identity and
 * would spin on a fresh object every render. Null before hydration — the server has no URL
 * to read, and guessing would have the folder store queried for the wrong project.
 */
const UNKNOWN = { key: null, name: null } as const;
let project: { key: string; name: string | null } | undefined;

function readProject(): { key: string | null; name: string | null } {
  project ??= (() => {
    const dir = new URLSearchParams(window.location.search).get("dir");
    const path = dir && dir.length <= MAX_KEY ? dir : null;
    return {
      key: path ?? "default",
      name: path ? (path.split("/").filter(Boolean).pop() ?? path) : null,
    };
  })();
  return project;
}

const beforeHydration = () => UNKNOWN;

/**
 * The live view: a program on the left, the thing it builds on the right, and nothing else.
 *
 * Everything that makes the studio the studio — the agent, the history, saving, exporting —
 * is deliberately absent. This is for someone whose design work is happening in a terminal
 * or an editor and who just needs to see the object, so the page earns its space by being a
 * window rather than an application.
 *
 * There is no server behind it. The page reads the `.scad` off disk through folder access
 * the person granted, and the code is read-only because the file is the one true copy — an
 * editable pane here would give you somewhere to make a change the next save throws away.
 */
export function ScadView() {
  const { key: projectKey, name: projectName } = useBrowserOnly(readProject, beforeHydration);
  const [plateSizeMm, setPlateSizeMm] = usePlateSize();
  const [showHelp, setShowHelp] = useState(false);
  const { width: panelWidth, handleProps } = usePanelWidth(WIDTH_KEY);

  const watched = useWatchedScad(projectKey);
  const {
    modelUrl,
    isRendering,
    error: renderError,
    metrics,
    section,
    mesh,
    render,
    setSection,
  } = useScadRenderer(plateSizeMm);

  // `current` only changes identity when the file's contents actually change, so this fires
  // once per save rather than once per poll.
  const code = watched.current?.code ?? null;
  useEffect(() => {
    if (code !== null) render(code);
  }, [code, render]);

  const snapTargets =
    mesh && metrics && !metrics.empty
      ? { vertices: mesh.vertices, lowestZ: metrics.lowestZ }
      : null;

  const connected = watched.state === "watching" && code !== null;

  const fileOptions: ReadonlyArray<DropdownOption<string>> = [
    { value: NEWEST, label: "Newest edit" },
    ...watched.files.map((file) => ({ value: file.path, label: file.path })),
  ];

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink-900">
      <header className="flex shrink-0 items-center gap-4 border-b border-ink-700 bg-ink-850 px-4 py-2.5">
        <Link href="/" aria-label="Scaid" className="shrink-0 opacity-70 transition hover:opacity-100">
          <Logo size={20} withWordmark={false} />
        </Link>

        {watched.state === "watching" ? (
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={watched.chooseFolder}
              title="Watch a different folder"
              className="flex min-w-0 shrink items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-medium text-mist-300 transition hover:bg-ink-800 hover:text-mist-100"
            >
              <FolderOpen size={14} weight="duotone" className="shrink-0 text-volt-300" />
              <span className="truncate">{watched.folderName}</span>
            </button>

            {watched.files.length > 0 && (
              <Dropdown
                label="Which file to show"
                icon={<FileCode size={15} weight="duotone" className="text-cyan-400" />}
                value={watched.pinned ?? NEWEST}
                options={fileOptions}
                onChange={(next) => watched.pin(next === NEWEST ? null : next)}
              />
            )}

            {watched.current && (
              <span className="hidden truncate font-mono text-xs text-ink-500 lg:block">
                {watched.current.path}
              </span>
            )}
          </div>
        ) : (
          <span className="truncate text-xs font-medium text-mist-500">
            {projectName ? `Not watching ${projectName} yet` : "Nothing being watched yet"}
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <PlateSizePicker plateSizeMm={plateSizeMm} onChange={setPlateSizeMm} />
          <button
            onClick={() => setShowHelp((open) => !open)}
            className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-mist-300 transition hover:border-ink-600 hover:text-mist-100"
          >
            {showHelp ? <X size={14} weight="bold" /> : <Question size={14} weight="duotone" />}
            {showHelp ? "Close" : "How"}
          </button>
        </div>
      </header>

      <main
        style={{ "--panel-width": `${panelWidth}px` } as React.CSSProperties}
        className="relative z-0 grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[var(--panel-width)_1fr]"
      >
        <section className="relative flex min-h-0 flex-col border-ink-700 bg-ink-850 lg:border-r">
          {showHelp || !connected ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <ScadViewConnect
                state={watched.state}
                folderName={watched.folderName}
                error={watched.error}
                onChoose={watched.chooseFolder}
                onGrant={watched.grant}
                compact={connected}
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col pt-3">
              <CodeEditor
                code={code ?? ""}
                onChange={() => {}}
                readOnly
                isRendering={isRendering}
                error={renderError}
              />
            </div>
          )}

          <div
            {...handleProps}
            className="absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize transition-colors hover:bg-volt-500/40 focus-visible:bg-volt-500/60 lg:block"
          />
        </section>

        <section className="relative flex min-h-0 flex-col bg-ink-900">
          <ModelViewer
            src={modelUrl}
            spinning={isRendering}
            section={section}
            modelBounds={metrics && !metrics.empty ? metrics.bounds : null}
            modelRadiusMm={metrics?.boundingRadius}
            snapTargets={snapTargets}
            onSection={setSection}
            emptyHint="Pick the folder you're designing in and your newest .scad appears here."
          />
          {isRendering && <WorkingOverlay label="Building the model…" />}
        </section>
      </main>
    </div>
  );
}

/**
 * The build plate size, remembered separately from the studio's.
 *
 * A tiny external store rather than component state, for the same reason the panel width is
 * one: localStorage can't be read while rendering on the server, and reading it in an effect
 * costs a second render on every mount.
 */
let plateSize: number | null = null;
const plateListeners = new Set<() => void>();

function readPlateSize(): number {
  plateSize ??= (() => {
    try {
      return normalizePlateSize(localStorage.getItem(PLATE_KEY)) ?? DEFAULT_SETTINGS.plateSizeMm;
    } catch {
      return DEFAULT_SETTINGS.plateSizeMm; // private browsing can refuse storage
    }
  })();
  return plateSize;
}

const serverPlateSize = () => DEFAULT_SETTINGS.plateSizeMm;

function usePlateSize(): [number, (next: number) => void] {
  const size = useSyncExternalStore(subscribePlateSize, readPlateSize, serverPlateSize);

  return [
    size,
    (next: number) => {
      plateSize = next;
      try {
        localStorage.setItem(PLATE_KEY, String(next));
      } catch {
        // Not worth surfacing — the size just won't be remembered.
      }
      plateListeners.forEach((listener) => listener());
    },
  ];
}

function subscribePlateSize(listener: () => void) {
  plateListeners.add(listener);
  return () => {
    plateListeners.delete(listener);
  };
}
