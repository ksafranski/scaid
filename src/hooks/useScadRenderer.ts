"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseOff } from "@/io/import_off";
import type { IndexedPolyhedron } from "@/io/common";
import { exportGlb } from "@/io/export_glb";
import { friendlyError } from "@/lib/friendlyErrors";
import { extractRequestedColors } from "@/lib/scadColors";

/** Outside dimensions of the model in millimeters — what you'd measure with calipers. */
export interface ModelSize {
  x: number;
  y: number;
  z: number;
}

export interface RenderState {
  modelUrl: string | null;
  isRendering: boolean;
  error: { friendly: string; detail: string } | null;
  size: ModelSize | null;
}

function measure(polyhedron: IndexedPolyhedron): ModelSize | null {
  if (!polyhedron.vertices.length) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of polyhedron.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
}

/**
 * Compiles OpenSCAD to a GLB the viewer can show.
 *
 * The heavy work runs in a Web Worker so typing and animation stay smooth. Renders are
 * tagged with a request id, and stale replies are dropped — otherwise a slow render of
 * old code can land after a fast render of new code and show the wrong shape.
 */
export function useScadRenderer(plateSizeMm: number) {
  const workerRef = useRef<Worker | null>(null);
  const latestRequestRef = useRef(0);
  const codeByRequestRef = useRef(new Map<number, string>());
  const objectUrlRef = useRef<string | null>(null);
  /** Code for the render currently in flight, so it can be re-issued to a new worker. */
  const pendingCodeRef = useRef<string | null>(null);

  const [state, setState] = useState<RenderState>({
    modelUrl: null,
    isRendering: false,
    error: null,
    size: null,
  });

  // Kept so changing the plate size can redraw the grid without recompiling the model.
  const lastMeshRef = useRef<IndexedPolyhedron | null>(null);
  const plateSizeRef = useRef(plateSizeMm);

  // The worker's message handler is created once, so it reads the plate size through a ref
  // rather than closing over a stale value.
  useEffect(() => {
    plateSizeRef.current = plateSizeMm;
  }, [plateSizeMm]);

  useEffect(() => {
    const worker = new Worker("/openscad-worker.js", { type: "module" });
    workerRef.current = worker;

    worker.onmessage = async (event: MessageEvent) => {
      const { requestId, off, error } = event.data ?? {};
      const sourceCode = codeByRequestRef.current.get(requestId) ?? "";
      codeByRequestRef.current.delete(requestId);
      if (requestId !== latestRequestRef.current) return; // a newer render already won

      pendingCodeRef.current = null;

      if (error) {
        // Keep the last good model on screen. While someone is editing, the code is invalid
        // for most keystrokes, and blanking the viewport on every one of them is unusable.
        setState((prev) => ({
          ...prev,
          isRendering: false,
          error: { friendly: friendlyError(error), detail: error },
        }));
        return;
      }

      try {
        // Keep only the colors the program asked for; OpenSCAD's own defaults become gray.
        const polyhedron = parseOff(off, extractRequestedColors(sourceCode));
        lastMeshRef.current = polyhedron;
        const blob = await exportGlb(polyhedron, plateSizeRef.current);
        const url = URL.createObjectURL(blob);

        if (requestId !== latestRequestRef.current) {
          URL.revokeObjectURL(url); // superseded while we were building the GLB
          return;
        }

        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setState({ modelUrl: url, isRendering: false, error: null, size: measure(polyhedron) });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          isRendering: false,
          error: { friendly: friendlyError(detail), detail },
        }));
      }
    };

    // A render can be in flight when the worker goes away — React's development
    // double-mount terminates it between the request and the reply, and a crashed worker
    // would do the same in production. Re-issue it against the new worker rather than
    // leaving the UI stuck on "Building…" forever.
    if (pendingCodeRef.current) {
      const requestId = ++latestRequestRef.current;
      codeByRequestRef.current.set(requestId, pendingCodeRef.current);
      worker.postMessage({ code: pendingCodeRef.current, requestId });
    }

    return () => {
      worker.terminate();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mesh = lastMeshRef.current;
    if (!mesh) return;
    let cancelled = false;

    (async () => {
      const blob = await exportGlb(mesh, plateSizeMm);
      if (cancelled) return;

      const url = URL.createObjectURL(blob);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = url;
      setState((prev) => ({ ...prev, modelUrl: url }));
    })();

    return () => {
      cancelled = true;
    };
  }, [plateSizeMm]);

  /** Clears the viewport for a fresh build, so nothing from the last one lingers. */
  const reset = useCallback(() => {
    // Bump the request id so a render still in flight can't repopulate the viewport.
    latestRequestRef.current++;
    pendingCodeRef.current = null;
    lastMeshRef.current = null;
    codeByRequestRef.current.clear();

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;

    setState({ modelUrl: null, isRendering: false, error: null, size: null });
  }, []);

  const render = useCallback((code: string) => {
    if (!workerRef.current || !code.trim()) return;
    const requestId = ++latestRequestRef.current;
    codeByRequestRef.current.set(requestId, code);
    pendingCodeRef.current = code;
    setState((prev) => ({ ...prev, isRendering: true, error: null }));
    workerRef.current.postMessage({ code, requestId });
  }, []);

  return { ...state, render, reset };
}
