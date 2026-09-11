"use client";

/**
 * Compiles a program once, in a worker of its own.
 *
 * Separate from the preview's worker on purpose. The preview drops a render the moment a
 * newer one is asked for, which is right for something being typed at and wrong for a job
 * whose whole point is its answer — an export, or a check on a model nobody is looking at.
 * A worker per job also means the two never queue behind each other.
 */
const TIMEOUT_MS = 120_000;

export type RenderFormat = "off" | "binstl";

type Result<F extends RenderFormat> = F extends "binstl" ? Uint8Array : string;

export function renderOnce<F extends RenderFormat>(code: string, format: F): Promise<Result<F>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/openscad-worker.js", { type: "module" });

    const finish = (action: () => void) => {
      clearTimeout(timer);
      worker.terminate();
      action();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error("The model took too long to build."))),
      TIMEOUT_MS,
    );

    worker.onmessage = (event: MessageEvent) => {
      const { off, stl, error } = event.data ?? {};
      if (error) finish(() => reject(new Error(error)));
      else if (format === "binstl" && stl) finish(() => resolve(stl as Result<F>));
      else if (format === "off" && typeof off === "string") finish(() => resolve(off as Result<F>));
      else finish(() => reject(new Error("The build came back empty.")));
    };

    worker.onerror = (event) => finish(() => reject(new Error(event.message)));

    worker.postMessage({ code, requestId: 1, format });
  });
}
