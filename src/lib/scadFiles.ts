/**
 * Finding the OpenSCAD file to watch inside a folder the person handed us.
 *
 * The browser can read a directory once you've picked it, but it has no idea which file you
 * care about and no way to be told when one changes. So this walks the tree, keeps the
 * `.scad` files, and the caller watches whichever was edited most recently — which is
 * exactly the one an editor or an agent just wrote.
 *
 * The File System Access types are declared here structurally rather than imported from the
 * DOM lib. Two reasons: the lib's coverage of this API still moves around between TypeScript
 * releases, and a structural interface means the walk can be exercised against fake handles
 * in a plain Node script, which is the only way any of this gets tested without a person
 * clicking through a native file dialog.
 */

export interface PickedFile {
  lastModified: number;
  size: number;
  text(): Promise<string>;
}

export interface ScadFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<PickedFile>;
}

export interface ScadDirectoryHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterable<ScadFileHandle | ScadDirectoryHandle>;
}

/** One `.scad` found in the tree, with the metadata used to decide if it's the interesting one. */
export interface FoundScad {
  /** Path relative to the picked folder, for showing which file this is. */
  path: string;
  handle: ScadFileHandle;
  lastModified: number;
  size: number;
}

/**
 * Directories never worth walking into.
 *
 * Dependency and build trees are enormous and contain nothing anyone is designing. The
 * dot-directory rule matters more than the list does: it's what keeps `.git` out, and in
 * this repo it's what stops a scan from wading through the thousand `.scad` files in a
 * vendored BOSL2 checkout.
 */
const SKIPPED = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  "__pycache__",
  "venv",
]);

function worthEntering(name: string): boolean {
  return !name.startsWith(".") && !SKIPPED.has(name);
}

export function isScad(name: string): boolean {
  return name.toLowerCase().endsWith(".scad");
}

/** How deep to go, and how many files to bother with. Both are about bounding a scan that
 * runs on a timer, not about correctness — a project nested deeper than this, or with more
 * `.scad` files than this, isn't one you're watching a single model in. */
const MAX_DEPTH = 8;
const MAX_FILES = 400;

/**
 * Every `.scad` under a picked folder, with its size and modification time.
 *
 * Only metadata is read — `getFile()` hands back a File without touching the contents — so
 * this stays cheap enough to repeat on a timer and notice a file that didn't exist before.
 */
export async function scanForScad(
  directory: ScadDirectoryHandle,
  { maxDepth = MAX_DEPTH, maxFiles = MAX_FILES } = {},
): Promise<FoundScad[]> {
  const found: FoundScad[] = [];

  async function walk(handle: ScadDirectoryHandle, prefix: string, depth: number) {
    if (depth > maxDepth || found.length >= maxFiles) return;

    for await (const entry of handle.values()) {
      if (found.length >= maxFiles) return;

      if (entry.kind === "directory") {
        if (worthEntering(entry.name)) await walk(entry, `${prefix}${entry.name}/`, depth + 1);
        continue;
      }

      if (!isScad(entry.name)) continue;

      try {
        const file = await entry.getFile();
        found.push({
          path: `${prefix}${entry.name}`,
          handle: entry,
          lastModified: file.lastModified,
          size: file.size,
        });
      } catch {
        // Deleted between being listed and being read. It isn't there, so it isn't a result.
      }
    }
  }

  await walk(directory, "", 0);
  return found;
}

/**
 * The one that was edited last.
 *
 * This is the whole selection rule, and it's right because of what it's selecting for: the
 * file somebody — or something — just saved is the file they want to look at. Ties break on
 * path so that a folder full of files written in the same millisecond still picks
 * deterministically rather than flickering between them.
 */
export function newestScad(files: readonly FoundScad[]): FoundScad | null {
  let best: FoundScad | null = null;
  for (const file of files) {
    if (
      !best ||
      file.lastModified > best.lastModified ||
      (file.lastModified === best.lastModified && file.path < best.path)
    ) {
      best = file;
    }
  }
  return best;
}

/** Whether a file has been touched since we last looked at it. */
export function changed(
  file: { lastModified: number; size: number },
  seen: { lastModified: number; size: number } | null,
): boolean {
  return !seen || file.lastModified !== seen.lastModified || file.size !== seen.size;
}
