"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowUpRight,
  ArrowUUpLeft,
  CircleNotch,
  Cube,
  Lasso,
  Trash,
  type Icon,
} from "@phosphor-icons/react";
import { MARKUP_COLOR, REGION_FILL, renderMarkup, type Mark, type MarkPoint } from "@/lib/markup";
import type { PreparedImage } from "@/lib/imageAttachment";
import type { ModelViewerElement } from "@/types/model-viewer";

// The model sits Z-up like OpenSCAD; model-viewer is Y-up, so tip it a quarter turn.
const ORIENTATION = "0deg -90deg 0deg";
const HOME_ORBIT = "-40deg 70deg 320mm";
const HOME_TARGET = "0m 0.03m 0m";

/**
 * The key to hold for sliding the model around.
 *
 * model-viewer pans on Ctrl, Meta, Shift or a right-click drag, so both of these genuinely
 * work everywhere — this only picks the one that reads as native. Safe to call during
 * render: the viewer renders nothing but "Warming up…" until the custom element has loaded
 * in the browser, so the server never produces markup this could disagree with.
 */
function panModifier(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  // `platform` is deprecated but is still the most dependable Mac signal in every browser.
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
}

type Tool = "region" | "arrow";

/**
 * What a spec-document snapshot gets painted onto.
 *
 * The viewer is transparent so the studio's background shows through, but a transparent PNG
 * lands on the white page of a document with the grid and the shadows — both drawn for a
 * dark backdrop — sitting on nothing. Flattening onto the studio's own color keeps the
 * picture looking like the thing they were just looking at.
 */
const SNAPSHOT_BACKDROP = "#0b0e14"; // --color-ink-900, the preview panel's own background

/** Enough for a full-page picture in a document, without a megabyte of PNG. */
const SNAPSHOT_MAX_EDGE = 1600;

/** Draws the viewer's transparent snapshot onto the studio's background. */
async function flatten(snapshot: string): Promise<string | null> {
  const source = await new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = snapshot;
  });
  if (!source?.naturalWidth) return null;

  const fit = Math.min(1, SNAPSHOT_MAX_EDGE / Math.max(source.naturalWidth, source.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.naturalWidth * fit);
  canvas.height = Math.round(source.naturalHeight * fit);

  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = SNAPSHOT_BACKDROP;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** What the composer collects as it sends. */
export interface Markup {
  image: PreparedImage;
}

export function ModelViewer({
  src,
  spinning,
  captureRef,
  snapshotRef,
}: {
  src: string | null;
  spinning: boolean;
  /**
   * Filled in with a function the composer calls as it sends.
   *
   * Marks aren't an attachment you add and then look at — they sit on the model where you
   * drew them, and they're collected at the moment the message goes.
   */
  captureRef?: React.MutableRefObject<(() => Promise<Markup | null>) | null>;
  /**
   * Filled in with a function that returns the view as a PNG data URL, for the spec
   * document. Null while there's nothing on screen worth picturing.
   */
  snapshotRef?: React.MutableRefObject<(() => Promise<string | null>) | null>;
}) {
  const viewerRef = useRef<ModelViewerElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [drawing, setDrawing] = useState<Mark | null>(null);
  /**
   * The mark being drawn, held in a ref as well as in state.
   *
   * State drives what you see; the ref is what the handlers read. Pointer events can arrive
   * faster than React re-renders, and a handler reading the state variable would then be
   * looking at a stale value — reliably so when a whole gesture lands in one task.
   */
  const drawingRef = useRef<Mark | null>(null);

  const marking = tool !== null || marks.length > 0;
  const [ready, setReady] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  // The custom element registers itself on import, and only works in the browser.
  useEffect(() => {
    let cancelled = false;
    import("@google/model-viewer").then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // model-viewer needs a moment to decode the GLB after we hand it the URL. Without
  // tracking its "load" event the viewer sits blank in between, which reads as a failure.
  // Derived rather than stored, so switching src automatically falls back to "loading"
  // without an extra render pass.
  const modelShown = Boolean(src) && loadedSrc === src;

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !src) return;

    const onLoad = () => setLoadedSrc(src);

    // The model can finish loading before this listener attaches — on a re-mount, or when
    // the blob is already decoded. Subscribing alone would then wait for an event that has
    // already fired and leave the "Almost ready" overlay up for good, so read the current
    // state too.
    if (viewer.loaded) onLoad();

    viewer.addEventListener("load", onLoad);
    return () => viewer.removeEventListener("load", onLoad);
  }, [src, ready]);

  function pointIn(event: React.PointerEvent<HTMLDivElement>): MarkPoint {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function addMark(mark: Mark) {
    setMarks((prev) => [...prev, mark]);
  }

  function clearAll() {
    setMarks([]);
    drawingRef.current = null;
    setDrawing(null);
    setTool(null);
  }

  /**
   * Hands the composer the marked-up view, then wipes the slate.
   *
   * Cleared on the way out because the marks describe the model as it looks right now — the
   * moment the answer arrives and the shape changes, they'd be pointing at the wrong thing.
   */
  useEffect(() => {
    if (!captureRef) return;

    captureRef.current = async () => {
      const viewer = viewerRef.current;
      const surface = surfaceRef.current;
      if (!viewer || !surface || marks.length === 0) return null;

      const box = surface.getBoundingClientRect();
      const image = await renderMarkup(
        viewer.toDataURL("image/jpeg", 0.92),
        marks,
        box.width,
        box.height,
      );
      if (!image) return null;

      clearAll();
      return { image };
    };

    return () => {
      captureRef.current = null;
    };
  });

  /**
   * The view as it stands, as a picture.
   *
   * Whatever they've spun the model to is the shot — a spec is written about the angle the
   * person chose to look at it from, not about a canonical pose they never saw.
   */
  useEffect(() => {
    if (!snapshotRef) return;

    snapshotRef.current = async () => {
      const viewer = viewerRef.current;
      if (!viewer || !modelShown) return null;
      return flatten(viewer.toDataURL("image/png"));
    };

    return () => {
      snapshotRef.current = null;
    };
  }, [snapshotRef, modelShown]);

  const resetView = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.cameraOrbit = HOME_ORBIT;
    viewer.cameraTarget = HOME_TARGET;
    viewer.jumpCameraToGoal();
  }, []);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center gap-2.5 text-sm text-mist-500">
        <CircleNotch size={16} weight="bold" className="animate-spin text-volt-300" />
        Warming up…
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <model-viewer
        ref={viewerRef}
        src={src ?? ""}
        alt="Your 3D creation. Drag to spin it around."
        {...(marking ? {} : { "camera-controls": true })}
        orientation={ORIENTATION}
        camera-orbit={HOME_ORBIT}
        camera-target={HOME_TARGET}
        min-camera-orbit="auto auto 40mm"
        max-camera-orbit="auto auto 1200mm"
        environment-image="neutral"
        shadow-intensity="1.2"
        shadow-softness="0.6"
        tone-mapping="neutral"
        exposure="1.1"
        interaction-prompt="none"
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "transparent",
          visibility: src ? "visible" : "hidden",
        }}
      />

      {src && modelShown && (
        <div
          ref={surfaceRef}
          onPointerDown={(event) => {
            if (!tool) return;
            const at = pointIn(event);

            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // The line just won't follow the cursor outside the box; not worth losing it.
            }
            const started: Mark =
              tool === "region" ? { kind: "region", points: [at] } : { kind: "arrow", from: at, to: at };
            drawingRef.current = started;
            setDrawing(started);
          }}
          onPointerMove={(event) => {
            const current = drawingRef.current;
            if (!current) return;
            const at = pointIn(event);

            let next: Mark;
            if (current.kind === "arrow") {
              next = { ...current, to: at };
            } else if (current.kind === "region") {
              // Thin the trail: a point per pixel is noise in the polygon and in the line.
              const last = current.points[current.points.length - 1];
              if (last && Math.hypot(at.x - last.x, at.y - last.y) < 4) return;
              next = { ...current, points: [...current.points, at] };
            } else {
              return;
            }

            drawingRef.current = next;
            setDrawing(next);
          }}
          onPointerUp={() => {
            // From the ref, never from inside a setDrawing updater: updaters have to be pure
            // and development runs them twice to prove it, which committed every mark twice.
            const current = drawingRef.current;
            drawingRef.current = null;
            setDrawing(null);
            if (!current) return;

            // Below these it was a stray click, not a mark.
            if (current.kind === "region" && current.points.length >= 3) addMark(current);
            if (
              current.kind === "arrow" &&
              Math.hypot(current.to.x - current.from.x, current.to.y - current.from.y) > 12
            ) {
              addMark(current);
            }
          }}
          onPointerCancel={() => {
            drawingRef.current = null;
            setDrawing(null);
          }}
          className={`absolute inset-0 z-20 ${tool ? "cursor-crosshair" : "pointer-events-none"}`}
        >
          <svg className="pointer-events-none h-full w-full" aria-hidden>
            <defs>
              <marker id="markup-head" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                <path d="M0,0 L5,2.5 L0,5 Z" fill={MARKUP_COLOR} />
              </marker>
            </defs>

            {[...marks, ...(drawing ? [drawing] : [])].map((mark, index) =>
              mark.kind === "region" ? (
                <polyline
                  key={index}
                  points={mark.points.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill={REGION_FILL}
                  stroke={MARKUP_COLOR}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : mark.kind === "arrow" ? (
                <line
                  key={index}
                  x1={mark.from.x}
                  y1={mark.from.y}
                  x2={mark.to.x}
                  y2={mark.to.y}
                  stroke={MARKUP_COLOR}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  markerEnd="url(#markup-head)"
                />
              ) : null,
            )}
          </svg>

        </div>
      )}

      {src && modelShown && captureRef && (
        <div className="absolute top-5 right-5 z-30 flex items-center gap-1.5 rounded-xl border border-ink-700 bg-ink-850 p-1 shadow-lg shadow-black/40">
          <ToolButton active={tool === "region"} onClick={() => setTool(tool === "region" ? null : "region")} Glyph={Lasso} label="Circle a part" />
          <ToolButton active={tool === "arrow"} onClick={() => setTool(tool === "arrow" ? null : "arrow")} Glyph={ArrowUpRight} label="Point at something" />

          {marks.length > 0 && (
            <>
              <span aria-hidden className="mx-0.5 h-5 w-px bg-ink-700" />
              <ToolButton
                onClick={() => setMarks((prev) => prev.slice(0, -1))}
                Glyph={ArrowUUpLeft}
                label="Undo the last mark"
              />
              <ToolButton onClick={clearAll} Glyph={Trash} label="Clear all marks" />
            </>
          )}
        </div>
      )}

      {src && modelShown && marking && (
        <p className="pointer-events-none absolute top-20 right-5 z-20 max-w-[15rem] rounded-lg bg-ink-850/95 px-3 py-1.5 text-right text-xs font-medium text-mist-300">
          {marks.length > 0
            ? `${marks.length} mark${marks.length === 1 ? "" : "s"} — sent with your next message`
            : tool === "region"
              ? "Draw a loop around a part"
              : "Drag to point at something"}
        </p>
      )}

      {src && modelShown && (
        <button
          onClick={resetView}
          className="absolute right-5 bottom-5 flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850/90 px-3.5 py-2 text-xs font-semibold text-mist-300 backdrop-blur transition hover:border-ink-600 hover:text-mist-100"
        >
          <ArrowCounterClockwise size={14} weight="bold" />
          Reset view
        </button>
      )}

      {src && modelShown && (
        <div className="pointer-events-none absolute bottom-5 left-5 max-w-[calc(100%-10rem)] text-xs font-medium text-mist-500">
          Drag to spin · scroll to zoom · {panModifier()} + drag to move
        </div>
      )}

      {src && !modelShown && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-850/90 px-5 py-3 text-sm font-medium text-mist-300 backdrop-blur">
            <CircleNotch size={16} weight="bold" className="animate-spin text-volt-300" />
            Almost ready…
          </div>
        </div>
      )}

      {!src && !spinning && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center">
          <div className="flex flex-col items-center">
            <Cube size={56} weight="duotone" className="text-ink-600" />
            <p className="font-display mt-5 text-lg font-semibold text-mist-500">Nothing built yet</p>
            <p className="mt-1 text-sm text-ink-500">Describe something on the left to get started.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** One markup tool. Icon-only, because three labelled buttons would cover the model. */
function ToolButton({
  active,
  onClick,
  Glyph,
  label,
}: {
  active?: boolean;
  onClick: () => void;
  Glyph: Icon;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      style={active ? { backgroundColor: MARKUP_COLOR } : undefined}
      className={`rounded-lg p-2 transition ${
        active ? "text-white" : "text-mist-300 hover:bg-ink-700 hover:text-mist-100"
      }`}
    >
      <Glyph size={17} weight="bold" />
    </button>
  );
}
