"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, CircleNotch, Cube, Lasso, X } from "@phosphor-icons/react";
import type { LassoPoint } from "@/lib/regionCapture";
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

export function ModelViewer({
  src,
  spinning,
  onRegion,
}: {
  src: string | null;
  spinning: boolean;
  /** Called with the loop that was drawn, plus a snapshot of what it was drawn over. */
  onRegion?: (snapshot: string, path: LassoPoint[], width: number, height: number) => void;
}) {
  const viewerRef = useRef<ModelViewerElement>(null);
  const [lassoing, setLassoing] = useState(false);
  const [path, setPath] = useState<LassoPoint[]>([]);
  const drawingRef = useRef(false);
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

  /**
   * The loop is drawn on an overlay rather than on the viewer itself.
   *
   * That's also what keeps the camera still while you draw: the overlay takes the pointer
   * events, so model-viewer never sees a drag and never orbits out from under the line.
   */
  function pointIn(event: React.PointerEvent<HTMLDivElement>): LassoPoint {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function finishLasso(box: DOMRect) {
    const viewer = viewerRef.current;
    // Three points is the least that encloses anything; below that it was a stray click.
    if (viewer && path.length >= 3 && onRegion) {
      onRegion(viewer.toDataURL("image/jpeg", 0.92), path, box.width, box.height);
    }
    setPath([]);
    setLassoing(false);
    drawingRef.current = false;
  }

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
        camera-controls
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

      {src && modelShown && lassoing && (
        <div
          onPointerDown={(event) => {
            // Keeps the line following the cursor if it leaves the viewer mid-loop. Throws
            // if the pointer is already gone, which is not a reason to lose the stroke.
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // drawing still works, it just won't track outside the box
            }
            drawingRef.current = true;
            setPath([pointIn(event)]);
          }}
          onPointerMove={(event) => {
            if (!drawingRef.current) return;
            const next = pointIn(event);
            // Thin the trail out: a point per pixel is noise in the polygon and in the line.
            setPath((prev) => {
              const last = prev[prev.length - 1];
              if (last && Math.hypot(next.x - last.x, next.y - last.y) < 4) return prev;
              return [...prev, next];
            });
          }}
          onPointerUp={(event) => finishLasso(event.currentTarget.getBoundingClientRect())}
          onPointerCancel={() => {
            setPath([]);
            drawingRef.current = false;
          }}
          className="absolute inset-0 z-20 cursor-crosshair"
        >
          <svg className="pointer-events-none h-full w-full" aria-hidden>
            {path.length > 1 && (
              <polyline
                points={path.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="rgba(255, 45, 120, 0.12)"
                stroke="#ff2d78"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
          </svg>

          {path.length === 0 && (
            <p className="pointer-events-none absolute inset-x-0 top-5 text-center text-xs font-medium text-mist-300">
              Draw a loop around the part you want to talk about
            </p>
          )}
        </div>
      )}

      {src && modelShown && onRegion && (
        <button
          onClick={() => {
            setPath([]);
            setLassoing((on) => !on);
          }}
          // Sits on top of whatever the model happens to look like, so it carries its own
          // opaque background rather than tinting the scene through it — a translucent panel
          // over a pale model left it barely there. The pink is the color the lasso draws in,
          // so the tool is recognizable before it's ever used.
          className={`absolute top-5 right-5 z-30 flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-semibold shadow-lg transition ${
            lassoing
              ? "border-[#ff2d78] bg-[#ff2d78]/20 text-mist-100 shadow-[#ff2d78]/25"
              : "border-[#ff2d78]/40 bg-ink-800 text-mist-100 shadow-black/40 hover:border-[#ff2d78] hover:bg-ink-700"
          }`}
        >
          {lassoing ? (
            <X size={15} weight="bold" />
          ) : (
            <Lasso size={15} weight="bold" className="text-[#ff2d78]" />
          )}
          {lassoing ? "Cancel" : "Circle a part"}
        </button>
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
