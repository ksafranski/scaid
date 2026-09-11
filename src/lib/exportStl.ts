"use client";

import { renderOnce } from "./renderOnce";

/** Renders OpenSCAD source to a binary STL for download. */
export function renderStl(code: string): Promise<Uint8Array> {
  return renderOnce(code, "binstl");
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
