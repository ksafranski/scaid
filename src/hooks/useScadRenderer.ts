"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseOff } from "@/io/import_off";
import type { IndexedPolyhedron } from "@/io/common";
import { exportGlb } from "@/io/export_glb";
import { friendlyError } from "@/lib/friendlyErrors";
import { extractRequestedColors } from "@/lib/scadColors";
import { inspectMesh, type GeometryReport } from "@/lib/geometry/inspect";
import { sectionSource, type Section } from "@/lib/geometry/section";
import type { Bounds } from "@/lib/geometry/inspect";

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
  /**
   * Everything measurable about the model, or null before anything has built.
   *
   * Always describes the WHOLE object, never a section of it: a cut is a way of looking at
   * the thing, not a different thing, and these numbers are handed to the design agent.
   */
  metrics: GeometryReport | null;
  /** The cut currently being looked through, or null for the whole model. */
  section: Section | null;
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
  const requestsRef = useRef(new Map<number, RenderRequest>());
  /** Code for the render currently in flight, so it can be re-issued to a new worker. */
  const pendingRef = useRef<RenderRequest | null>(null);
  /** The program as it now stands, so a cut can be re-rendered without being handed it again. */
  const codeRef = useRef("");

  const [state, setState] = useState<RenderState>({
    modelUrl: null,
    isRendering: false,
    error: null,
    size: null,
    metrics: null,
    section: null,
  });

  /**
   * The uncut model, kept apart from the cut one on purpose.
   *
   * This is the only thing measurements are ever taken from. If a section render were
   * allowed to land here, the facts on screen — and the facts sent to the agent — would
   * describe a model with a slice missing from it, which nobody built and nobody wants.
   */
  const plainMeshRef = useRef<IndexedPolyhedron | null>(null);
  const sectionMeshRef = useRef<IndexedPolyhedron | null>(null);
  /** Held so closing a section is instant rather than another compile. */
  const plainUrlRef = useRef<string | null>(null);
  const sectionUrlRef = useRef<string | null>(null);
  const sectionRef = useRef<Section | null>(null);
  const metricsRef = useRef<GeometryReport | null>(null);

  const plateSizeRef = useRef(plateSizeMm);

  // The worker's message handler is created once, so it reads the plate size through a ref
  // rather than closing over a stale value.
  useEffect(() => {
    plateSizeRef.current = plateSizeMm;
  }, [plateSizeMm]);

  const releasePlain = () => {
    if (plainUrlRef.current) URL.revokeObjectURL(plainUrlRef.current);
    plainUrlRef.current = null;
  };
  const releaseSection = () => {
    if (sectionUrlRef.current) URL.revokeObjectURL(sectionUrlRef.current);
    sectionUrlRef.current = null;
    sectionMeshRef.current = null;
  };

  useEffect(() => {
    const worker = new Worker("/openscad-worker.js", { type: "module" });
    workerRef.current = worker;

    worker.onmessage = async (event: MessageEvent) => {
      const { requestId, off, error } = event.data ?? {};
      const request = requestsRef.current.get(requestId);
      requestsRef.current.delete(requestId);
      if (requestId !== latestRequestRef.current) return; // a newer render already won

      pendingRef.current = null;
      const cut = request?.section ?? null;

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
        const polyhedron = parseOff(off, extractRequestedColors(request?.code ?? ""));
        const blob = await exportGlb(polyhedron, plateSizeRef.current);
        const url = URL.createObjectURL(blob);

        if (requestId !== latestRequestRef.current) {
          URL.revokeObjectURL(url); // superseded while we were building the GLB
          return;
        }

        if (cut) {
          if (sectionUrlRef.current) URL.revokeObjectURL(sectionUrlRef.current);
          sectionUrlRef.current = url;
          sectionMeshRef.current = polyhedron;
          setState((prev) => ({ ...prev, modelUrl: url, isRendering: false, error: null }));
          return;
        }

        releasePlain();
        plainUrlRef.current = url;
        plainMeshRef.current = polyhedron;
        setState((prev) => ({ ...prev, modelUrl: url, isRendering: false, error: null }));

        // Measuring is a pass over every triangle, and none of it is needed to draw the
        // model. Doing it after the browser has painted means a build appears exactly as
        // fast as it did before any of this existed, and the numbers fill in behind it.
        setTimeout(() => {
          if (requestId !== latestRequestRef.current) return;
          const metrics = inspectMesh(polyhedron);
          metricsRef.current = metrics;
          setState((prev) => ({
            ...prev,
            metrics,
            size: metrics.empty ? null : metrics.size,
          }));
        }, 0);
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
    if (pendingRef.current) {
      const requestId = ++latestRequestRef.current;
      const request = pendingRef.current;
      requestsRef.current.set(requestId, request);
      worker.postMessage({ code: sourceFor(request), requestId });
    }

    return () => {
      worker.terminate();
      releasePlain();
      releaseSection();
    };
  }, []);

  useEffect(() => {
    const mesh = sectionRef.current ? sectionMeshRef.current : plainMeshRef.current;
    if (!mesh) return;
    let cancelled = false;

    (async () => {
      const blob = await exportGlb(mesh, plateSizeMm);
      if (cancelled) return;

      const url = URL.createObjectURL(blob);
      if (sectionRef.current) {
        if (sectionUrlRef.current) URL.revokeObjectURL(sectionUrlRef.current);
        sectionUrlRef.current = url;
      } else {
        releasePlain();
        plainUrlRef.current = url;
      }
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
    pendingRef.current = null;
    plainMeshRef.current = null;
    metricsRef.current = null;
    sectionRef.current = null;
    codeRef.current = "";
    requestsRef.current.clear();

    releasePlain();
    releaseSection();

    setState({
      modelUrl: null,
      isRendering: false,
      error: null,
      size: null,
      metrics: null,
      section: null,
    });
  }, []);

  const issue = useCallback((code: string, section: Section | null, bounds: Bounds | null) => {
    if (!workerRef.current || !code.trim()) return;
    const requestId = ++latestRequestRef.current;
    const request: RenderRequest = { code, section, bounds };
    requestsRef.current.set(requestId, request);
    pendingRef.current = request;
    setState((prev) => ({ ...prev, isRendering: true, error: null }));
    workerRef.current.postMessage({ code: sourceFor(request), requestId });
  }, []);

  const render = useCallback(
    (code: string) => {
      codeRef.current = code;
      // A change to the program invalidates the cut: the bounds it was placed against have
      // moved, and someone editing has gone back to designing rather than inspecting.
      if (sectionRef.current) {
        sectionRef.current = null;
        releaseSection();
        setState((prev) => ({ ...prev, section: null }));
      }
      issue(code, null, null);
    },
    [issue],
  );

  /**
   * Opens, moves or closes the cut.
   *
   * Closing is free — the whole model's GLB was never thrown away — so a section can be
   * toggled on and off while comparing without paying for a compile each time.
   */
  const setSection = useCallback(
    (section: Section | null) => {
      if (!section) {
        sectionRef.current = null;
        latestRequestRef.current++; // a cut still in flight must not land after this
        releaseSection();
        setState((prev) => ({
          ...prev,
          section: null,
          modelUrl: plainUrlRef.current,
          isRendering: false,
        }));
        return;
      }

      // Nothing to cut through, or nothing measured to size the cut against.
      const metrics = metricsRef.current;
      if (!metrics || metrics.empty || !codeRef.current.trim()) return;

      sectionRef.current = section;
      setState((prev) => ({ ...prev, section }));
      issue(codeRef.current, section, metrics.bounds);
    },
    [issue],
  );

  return { ...state, render, reset, setSection };
}

interface RenderRequest {
  code: string;
  section: Section | null;
  /** The whole model's extents, which is what the cutting box is sized against. */
  bounds: Bounds | null;
}

/** What actually gets compiled: the program, or the program with a slice taken out of it. */
function sourceFor(request: RenderRequest): string {
  return request.section && request.bounds
    ? sectionSource(request.code, request.section, request.bounds)
    : request.code;
}
