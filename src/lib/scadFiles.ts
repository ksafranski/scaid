/**
 * Watching one OpenSCAD file the person handed us.
 *
 * A single file rather than a folder, deliberately. Granting a page read access to a project
 * directory means granting it everything in there — env files, keys, whatever else lives
 * beside the design — and "this viewer only reads .scad" is a promise in code rather than a
 * boundary the browser enforces. One file is a boundary the browser enforces.
 *
 * Which file to watch is worked out before the browser is involved: the Claude Code plugin
 * looks through the project from Node, where reading a directory needs no permission from
 * anyone, and puts the answer in the URL.
 *
 * The File System Access types are declared structurally rather than imported from the DOM
 * lib, because the lib's coverage of this API still moves between TypeScript releases.
 */

export interface PickedFile {
  lastModified: number;
  size: number;
  text(): Promise<string>;
}

/** A file handle, plus the permission calls Chromium hangs off it. */
export interface ScadFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<PickedFile>;
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

/**
 * Whether a file has been touched since we last looked at it.
 *
 * Size as well as modification time, because an editor that writes twice within the same
 * millisecond — which happens, and happens most often to the small files this watches —
 * would otherwise look unchanged.
 */
export function changed(
  file: { lastModified: number; size: number },
  seen: { lastModified: number; size: number } | null,
): boolean {
  return !seen || file.lastModified !== seen.lastModified || file.size !== seen.size;
}

/** The last segment of a path, for comparing what was picked against what was asked for. */
export function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}
