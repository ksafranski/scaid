/**
 * Remembering the files this browser has been shown.
 *
 * A file handle is structured-cloneable, so IndexedDB can hold the actual handle — not a
 * path, which a page has no way to reopen. Coming back to a file it has seen before then
 * costs one click to re-allow reading, or none at all if the person told the browser to
 * allow it on every visit.
 *
 * Keyed by the file's full path on disk, which the plugin puts in the URL. That's what makes
 * a second `/scad-view` on the same file land straight on the model.
 *
 * Everything here fails quietly. Storage can be refused outright in private browsing, and a
 * viewer that won't open because it couldn't write a bookmark would be a worse tool than one
 * that simply forgets.
 */

import type { ScadFileHandle } from "./scadFiles";

const DB_NAME = "scaid-scad-view";
const STORE = "files";
const VERSION = 2;

/**
 * The handle used most recently, whatever its path.
 *
 * Kept so the file dialog can be told where to start: opening in the folder you were last
 * working in is the difference between one click and a trip through your home directory.
 * The key can't collide with a real one, because real keys are absolute paths.
 */
const LAST_USED = "::last-used";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Version 1 kept directory handles under "folders". Nothing reads those any more, and
      // a stale grant on a whole project folder is exactly what this stopped asking for.
      if (db.objectStoreNames.contains("folders")) db.deleteObjectStore("folders");
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T | null>((resolve) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null; // storage refused, or the database couldn't be opened
  }
}

export async function rememberFile(path: string, handle: ScadFileHandle): Promise<void> {
  await withStore("readwrite", (store) => store.put(handle, path));
  await withStore("readwrite", (store) => store.put(handle, LAST_USED));
}

export function recallFile(path: string): Promise<ScadFileHandle | null> {
  return withStore<ScadFileHandle>("readonly", (store) => store.get(path));
}

/** Where the file dialog should start, if this browser has been here before. */
export function lastUsedFile(): Promise<ScadFileHandle | null> {
  return withStore<ScadFileHandle>("readonly", (store) => store.get(LAST_USED));
}

export function forgetFile(path: string): Promise<unknown> {
  return withStore("readwrite", (store) => store.delete(path));
}
