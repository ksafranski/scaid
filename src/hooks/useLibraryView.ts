"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "scaid.libraryView";

export type LibraryView = "cards" | "list";

/**
 * How the library is laid out, remembered between visits.
 *
 * Kept in a tiny external store rather than component state for the same reason the panel
 * width is: reading localStorage during render would make the server and client markup
 * disagree. useSyncExternalStore serves the default while hydrating and the stored value
 * immediately after.
 */
let current: LibraryView | null = null;
const listeners = new Set<() => void>();

function read(): LibraryView {
  try {
    return localStorage.getItem(STORAGE_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards"; // private browsing can refuse storage
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLibraryView(): [LibraryView, (next: LibraryView) => void] {
  const view = useSyncExternalStore(
    subscribe,
    () => (current ??= read()),
    () => "cards" as LibraryView,
  );

  const setView = useCallback((next: LibraryView) => {
    current = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice just won't survive the visit.
    }
    listeners.forEach((listener) => listener());
  }, []);

  return [view, setView];
}
