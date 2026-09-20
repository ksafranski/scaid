"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Eye, FileCode, Question, SidebarSimple, Sparkle, X } from "@phosphor-icons/react";
import { CodeEditor } from "./CodeEditor";
import { Logo } from "./Logo";
import { ModelViewer } from "./ModelViewer";
import { PlateSizePicker } from "./PrintControls";
import { ScadViewConnect } from "./ScadViewConnect";
import { WorkingOverlay } from "./Working";
import { useScadRenderer } from "@/hooks/useScadRenderer";
import { useScadSource } from "@/hooks/useScadSource";
import { usePanelWidth } from "@/hooks/usePanelWidth";
import { DEFAULT_SETTINGS, normalizePlateSize } from "@/lib/types";

const PLATE_KEY = "scaid.scadView.plateSizeMm";
/** Its own width, not the studio's — see usePanelWidth for why they're kept apart. */
const WIDTH_KEY = "scaid.scadView.panelWidth";
/** Whether the code panel is open. Remembered, but shut the first time you arrive. */
const CODE_KEY = "scaid.scadView.codeOpen";


/**
 * The live view: a program on the left, the thing it builds on the right, and nothing else.
 *
 * Everything that makes the studio the studio — the agent, the history, saving, exporting —
 * is deliberately absent. This is for someone whose design work is happening in a terminal
 * or an editor and who just needs to see the object, so the page earns its space by being a
 * window rather than an application.
 *
 * There is no server behind it: the program arrives in the URL's fragment, or off disk
 * through a file the person handed over. The code is read-only either way, because the file
 * is the one true copy — an editable pane here would only be somewhere to make a change that
 * the next rebuild throws away.
 *
 * The code panel starts shut. What someone opens this for is the object, and the program is
 * already in front of them in the editor they wrote it in.
 */
export function ScadView() {
  const [plateSizeMm, setPlateSizeMm] = usePlateSize();
  const [codeOpen, setCodeOpen] = useCodeOpen();
  const [showHelp, setShowHelp] = useState(false);
  const { width: panelWidth, handleProps } = usePanelWidth(WIDTH_KEY);

  const source = useScadSource();
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

  // `code` only changes identity when the program actually changes, so this fires once per
  // rebuild rather than once per poll or once per hash event.
  const code = source.code;
  useEffect(() => {
    if (code !== null) render(code);
  }, [code, render]);

  const snapTargets =
    mesh && metrics && !metrics.empty
      ? { vertices: mesh.vertices, lowestZ: metrics.lowestZ }
      : null;

  const showing = code !== null;

  // With nothing to show, the panel holds the instructions and has to be open — an empty
  // viewer and no way in would be a dead end.
  const panelOpen = !showing || showHelp || codeOpen;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink-900">
      <header className="flex shrink-0 items-center gap-4 border-b border-ink-700 bg-ink-850 px-4 py-2.5">
        <Link href="/" aria-label="Scaid" className="shrink-0 opacity-70 transition hover:opacity-100">
          <Logo size={20} withWordmark={false} />
        </Link>

        {showing ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <FileCode size={14} weight="duotone" className="shrink-0 text-cyan-400" />
            <span className="truncate font-mono text-xs text-mist-300">
              {source.name ?? "untitled.scad"}
            </span>
            {/* Which way the program got here. They behave differently — one is refreshed by
                Claude, the other keeps up on its own — so it's worth a word. */}
            {source.source === "file" ? (
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-400">
                <Eye size={13} weight="duotone" />
                watching
              </span>
            ) : (
              <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-volt-300 sm:flex">
                <Sparkle size={13} weight="duotone" />
                from Claude Code
              </span>
            )}
          </div>
        ) : (
          <span className="truncate text-xs font-medium text-mist-500">
            Waiting for a model
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <PlateSizePicker plateSizeMm={plateSizeMm} onChange={setPlateSizeMm} />

          {showing && (
            <button
              onClick={() => {
                // Reaching for the code while the instructions are up means the instructions
                // are done with, so this swaps rather than stacking two panels.
                if (showHelp) {
                  setShowHelp(false);
                  setCodeOpen(true);
                  return;
                }
                setCodeOpen(!codeOpen);
              }}
              aria-pressed={codeOpen && !showHelp}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                codeOpen && !showHelp
                  ? "border-volt-500 bg-volt-500/10 text-mist-100"
                  : "border-ink-700 text-mist-300 hover:border-ink-600 hover:text-mist-100"
              }`}
            >
              <SidebarSimple size={14} weight="duotone" />
              Code
            </button>
          )}

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
        className={`relative z-0 grid min-h-0 flex-1 grid-cols-1 ${
          panelOpen ? "lg:grid-cols-[var(--panel-width)_1fr]" : ""
        }`}
      >
        {panelOpen && (
        <section className="relative flex min-h-0 flex-col border-ink-700 bg-ink-850 lg:border-r">
          {showHelp || !showing ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <ScadViewConnect source={source} compact={showing} />
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
        )}

        <section className="relative flex min-h-0 flex-col bg-ink-900">
          <ModelViewer
            src={modelUrl}
            spinning={isRendering}
            section={section}
            modelBounds={metrics && !metrics.empty ? metrics.bounds : null}
            modelRadiusMm={metrics?.boundingRadius}
            snapTargets={snapTargets}
            onSection={setSection}
            emptyHint="Run /scad-view in Claude Code and your model appears here."
          />
          {isRendering && <WorkingOverlay label="Building the model…" />}
        </section>
      </main>
    </div>
  );
}

/**
 * Whether the code panel is open, remembered between visits.
 *
 * Shut by default: the model is what this page is for, and the program is already on screen
 * in whatever editor wrote it.
 */
let codeOpen: boolean | null = null;
const codeListeners = new Set<() => void>();

function readCodeOpen(): boolean {
  codeOpen ??= (() => {
    try {
      return localStorage.getItem(CODE_KEY) === "true";
    } catch {
      return false; // private browsing can refuse storage
    }
  })();
  return codeOpen;
}

const codeShutOnServer = () => false;

function useCodeOpen(): [boolean, (next: boolean) => void] {
  const open = useSyncExternalStore(subscribeCodeOpen, readCodeOpen, codeShutOnServer);

  return [
    open,
    (next: boolean) => {
      codeOpen = next;
      try {
        localStorage.setItem(CODE_KEY, String(next));
      } catch {
        // Not worth surfacing — it just won't be remembered.
      }
      codeListeners.forEach((listener) => listener());
    },
  ];
}

function subscribeCodeOpen(listener: () => void) {
  codeListeners.add(listener);
  return () => {
    codeListeners.delete(listener);
  };
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
