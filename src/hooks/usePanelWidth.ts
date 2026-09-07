"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

const STORAGE_KEY = "scaid.panelWidth";
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
 */
let current: number | null = null;
const listeners = new Set<() => void>();

function readStored(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return stored ? clamp(stored) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH; // private browsing can refuse storage
  }
}

function getSnapshot(): number {
  current ??= readStored();
  return current;
}

function getServerSnapshot(): number {
  return DEFAULT_WIDTH;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setWidth(next: number, persist: boolean) {
  current = clamp(next);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, String(current));
    } catch {
      // Not worth surfacing — the width just won't be remembered.
    }
  }
  listeners.forEach((listener) => listener());
}

export function usePanelWidth() {
  const width = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      current = readStored();
      listeners.forEach((listener) => listener());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { startX: event.clientX, startWidth: width };
      draggingRef.current = true;

      // A drag that wanders over the 3D canvas shouldn't select text or flicker the cursor.
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [width],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Written through on every move for a live drag, but only saved once it ends.
    setWidth(drag.startWidth + (event.clientX - drag.startX), false);
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    setWidth(getSnapshot(), true);
  }, []);

  /** Arrow keys resize too, so the handle isn't mouse-only. */
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 50 : 10;
    const delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    if (!delta) return;
    event.preventDefault();
    setWidth(getSnapshot() + delta, true);
  }, []);

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
