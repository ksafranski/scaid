"use client";

/**
 * Renders OpenSCAD source to a binary STL for download.
 *
 * Runs in its own short-lived worker rather than sharing the preview's: an export must never
 * be dropped as "stale" the way a superseded preview render is, and the two shouldn't
 * queue behind each other.
 */
const TIMEOUT_MS = 120_000;

export function renderStl(code: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/openscad-worker.js", { type: "module" });

    const finish = (action: () => void) => {
      clearTimeout(timer);
      worker.terminate();
      action();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error("The model took too long to export."))),
      TIMEOUT_MS,
    );

    worker.onmessage = (event: MessageEvent) => {
      const { stl, error } = event.data ?? {};
      if (error) finish(() => reject(new Error(error)));
      else if (stl) finish(() => resolve(stl as Uint8Array));
      else finish(() => reject(new Error("The export came back empty.")));
    };

    worker.onerror = (event) => finish(() => reject(new Error(event.message)));

    worker.postMessage({ code, requestId: 1, format: "binstl" });
  });
}

/** Turns a build name into something safe to save to disk, without an extension. */
export function toFileBase(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "model"
  );
}

/** Turns a build name into something safe to save to disk. */
export function toFileName(name: string, extension: string): string {
  return `${toFileBase(name)}.${extension}`;
}

/** Hands the browser a file to save, then releases the object URL. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
