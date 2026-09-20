"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

const DEFAULT_KEY = "scaid.panelWidth";
const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 340;
const MAX_WIDTH = 900;

const clamp = (value: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));

/**
 * The panel width lives in a tiny external store rather than component state.
 *
 * Reading localStorage during render would make the server and client markup disagree;
 * useSyncExternalStore is built for exactly this, serving the default during hydration and
 * the stored value immediately after. Subscribing to `storage` keeps two tabs in step.
 *
 * One store per key, because the studio and the live view are different rooms: a narrow
 * chat panel says nothing about how wide you want a read-only code pane, and sharing the
 * number would have resizing one quietly resize the other.
 */
interface Store {
  current: number | null;
  listeners: Set<() => void>;
}

const stores = new Map<string, Store>();

function storeFor(key: string): Store {
  let store = stores.get(key);
  if (!store) {
    store = { current: null, listeners: new Set() };
    stores.set(key, store);
  }
  return store;
}

function readStored(key: string): number {
  try {
    const stored = Number(localStorage.getItem(key));
    return stored ? clamp(stored) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH; // private browsing can refuse storage
  }
}

function setWidth(key: string, next: number, persist: boolean) {
  const store = storeFor(key);
  store.current = clamp(next);
  if (persist) {
    try {
      localStorage.setItem(key, String(store.current));
    } catch {
      // Not worth surfacing — the width just won't be remembered.
    }
  }
  store.listeners.forEach((listener) => listener());
}

export function usePanelWidth(key: string = DEFAULT_KEY) {
  // Rebuilt only when the key changes, so useSyncExternalStore isn't handed a new
  // subscriber on every render.
  const { subscribe, getSnapshot, getServerSnapshot } = useMemo(
    () => ({
      subscribe(listener: () => void) {
        const store = storeFor(key);
        store.listeners.add(listener);
        return () => {
          store.listeners.delete(listener);
        };
      },
      getSnapshot() {
        const store = storeFor(key);
        store.current ??= readStored(key);
        return store.current;
      },
      getServerSnapshot: () => DEFAULT_WIDTH,
    }),
    [key],
  );

  const width = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      const store = storeFor(key);
      store.current = readStored(key);
      store.listeners.forEach((listener) => listener());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { startX: event.clientX, startWidth: width };

      // A drag that wanders over the 3D canvas shouldn't select text or flicker the cursor.
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Written through on every move for a live drag, but only saved once it ends.
      setWidth(key, drag.startWidth + (event.clientX - drag.startX), false);
    },
    [key],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setWidth(key, getSnapshot(), true);
    },
    [key, getSnapshot],
  );

  /** Arrow keys resize too, so the handle isn't mouse-only. */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? 50 : 10;
      const delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      if (!delta) return;
      event.preventDefault();
      setWidth(key, getSnapshot() + delta, true);
    },
    [key, getSnapshot],
  );

  return {
    width,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-label": "Resize panel",
      "aria-valuenow": width,
      "aria-valuemin": MIN_WIDTH,
      "aria-valuemax": MAX_WIDTH,
      tabIndex: 0,
    },
  };
}
