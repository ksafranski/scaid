/**
 * Remembering which folder this tab was watching.
 *
 * A directory handle is structured-cloneable, so IndexedDB can hold the actual handle —
 * not a path string, which the browser would refuse to reopen anyway. Coming back to the
 * viewer then costs one click to re-grant read access instead of finding the project in a
 * file dialog again.
 *
 * Everything here fails quietly. Storage can be refused outright in private browsing, and a
 * viewer that won't open because it couldn't write a bookmark would be a worse tool than one
 * that simply forgets.
 */

const DB_NAME = "scaid-scad-view";
const STORE = "folders";
const VERSION = 1;

/** The handle as this app uses it: a directory, and the permission calls Chromium adds to it. */
export interface StoredFolder {
  kind: "directory";
  name: string;
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
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

export function rememberFolder(key: string, handle: StoredFolder): Promise<unknown> {
  return withStore("readwrite", (store) => store.put(handle, key));
}

export function recallFolder(key: string): Promise<StoredFolder | null> {
  return withStore<StoredFolder>("readonly", (store) => store.get(key));
}

export function forgetFolder(key: string): Promise<unknown> {
  return withStore("readwrite", (store) => store.delete(key));
}
