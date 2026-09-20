"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBrowserOnly } from "./useBrowserOnly";
import { forgetFolder, recallFolder, rememberFolder, type StoredFolder } from "@/lib/handleStore";
import {
  changed,
  newestScad,
  scanForScad,
  type FoundScad,
  type ScadDirectoryHandle,
} from "@/lib/scadFiles";

/**
 * How often the file being followed is checked for a new modification time.
 *
 * This is a metadata read against the local disk, not a network request, so it can be quick
 * without costing anything. A render takes longer than this anyway.
 */
const WATCH_MS = 400;

/**
 * How often the whole folder is walked again.
 *
 * Slower, because it's the expensive one and it only answers a rarer question: has a
 * *different* `.scad` become the most recently edited, or has a new one appeared.
 */
const RESCAN_MS = 2_000;

export type Watching =
  /** This browser can't open a folder at all. */
  | "unsupported"
  /** Nothing picked yet. */
  | "idle"
  /** A folder is remembered but the browser wants the person to re-allow reading it. */
  | "needs-permission"
  | "watching";

export interface WatchedScad {
  state: Watching;
  /** The folder's display name, known even before permission is granted. */
  folderName: string | null;
  /** Every `.scad` under it, newest first. */
  files: FoundScad[];
  /** The path being followed on purpose, or null to always follow the newest edit. */
  pinned: string | null;
  /** The file currently on screen, and its contents. */
  current: { path: string; code: string } | null;
  error: string | null;

  chooseFolder: () => Promise<void>;
  grant: () => Promise<void>;
  pin: (path: string | null) => void;
  forget: () => Promise<void>;
}

const supported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;
const unsupportedOnServer = () => false;

interface Picker {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: "read" | "readwrite";
  }): Promise<StoredFolder & ScadDirectoryHandle>;
}

/**
 * Watches a folder on disk and hands back whichever OpenSCAD file was edited most recently.
 *
 * There is no server in this and nothing leaves the machine: the page reads the file itself,
 * through the folder access the person granted, and notices edits by watching modification
 * times. Whatever writes the file — an agent, an editor, a script — needs to know nothing
 * about any of it.
 */
export function useWatchedScad(projectKey: string | null): WatchedScad {
  const canWatch = useBrowserOnly(supported, unsupportedOnServer);

  const [folderName, setFolderName] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);
  const [files, setFiles] = useState<FoundScad[]>([]);
  const [pinned, setPinned] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ path: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The live handle. A ref because the polling loop reads it and shouldn't restart on it. */
  const folderRef = useRef<(StoredFolder & ScadDirectoryHandle) | null>(null);
  /** What the followed file looked like last time, so an unchanged file costs one stat. */
  const seenRef = useRef<{ path: string; lastModified: number; size: number } | null>(null);
  const pinnedRef = useRef<string | null>(null);

  useEffect(() => {
    pinnedRef.current = pinned;
    // Pinning a different file has to re-read it, and the loop only re-reads what changed.
    seenRef.current = null;
  }, [pinned]);

  // A folder remembered from last time. Its name is readable without permission, so the
  // button can say which project it is before anyone clicks anything.
  useEffect(() => {
    // Null until the browser has read which project this tab is for. Recalling against a
    // placeholder key first would look up the wrong folder and then immediately discard it.
    if (!canWatch || !projectKey) return;
    let cancelled = false;

    void (async () => {
      const handle = await recallFolder(projectKey);
      if (cancelled || !handle) return;

      folderRef.current = handle as StoredFolder & ScadDirectoryHandle;
      setFolderName(handle.name);

      const permission = (await handle.queryPermission?.({ mode: "read" })) ?? "prompt";
      if (!cancelled && permission === "granted") setGranted(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [canWatch, projectKey]);

  // The watch itself: a quick check on the file being followed, and a slower walk of the
  // folder to notice a different one becoming the newest.
  useEffect(() => {
    if (!granted) return;

    let stopped = false;
    let watchTimer: ReturnType<typeof setTimeout> | null = null;
    let rescanTimer: ReturnType<typeof setTimeout> | null = null;
    let known: FoundScad[] = [];

    const idle = () => typeof document !== "undefined" && document.hidden;

    /** Reads whichever file we should be showing, if it has moved since last time. */
    async function check() {
      if (stopped) return;
      const target = pinnedRef.current
        ? (known.find((file) => file.path === pinnedRef.current) ?? null)
        : newestScad(known);

      if (!target) {
        if (seenRef.current) {
          seenRef.current = null;
          setCurrent(null);
        }
        return;
      }

      try {
        const file = await target.handle.getFile();
        if (stopped) return;

        const seen = seenRef.current;
        const sameFile = seen?.path === target.path;
        if (sameFile && !changed(file, seen)) return;

        const code = await file.text();
        if (stopped) return;

        seenRef.current = { path: target.path, lastModified: file.lastModified, size: file.size };
        // Compared rather than assumed: a save that didn't alter anything shouldn't throw
        // away a section or a measurement someone has open.
        setCurrent((prev) =>
          prev && prev.path === target.path && prev.code === code
            ? prev
            : { path: target.path, code },
        );
        setError(null);
      } catch {
        // Usually the file was renamed or deleted mid-read; the next rescan will notice.
        seenRef.current = null;
      }
    }

    async function rescan() {
      if (stopped || !folderRef.current) return;
      try {
        known = await scanForScad(folderRef.current);
        if (stopped) return;
        setFiles([...known].sort((a, b) => b.lastModified - a.lastModified));
        setError(
          known.length === 0 ? "No .scad files in that folder yet — write one and it appears." : null,
        );
      } catch {
        if (!stopped) setError("Lost access to that folder. Pick it again.");
      }
    }

    const loopWatch = async () => {
      if (!idle()) await check();
      if (!stopped) watchTimer = setTimeout(loopWatch, WATCH_MS);
    };

    const loopRescan = async () => {
      if (!idle()) await rescan();
      if (!stopped) rescanTimer = setTimeout(loopRescan, RESCAN_MS);
    };

    // Coming back to the tab shouldn't wait out a whole interval to catch up.
    const onVisible = () => {
      if (!idle()) void rescan().then(check);
    };
    document.addEventListener("visibilitychange", onVisible);

    // The first pass runs whether or not anyone is looking. A tab opened in the background,
    // or one restored from a previous session, should already have the model on it by the
    // time it's switched to — only the repeat is worth pausing.
    void (async () => {
      await rescan();
      await check();
      if (stopped) return;
      watchTimer = setTimeout(loopWatch, WATCH_MS);
      rescanTimer = setTimeout(loopRescan, RESCAN_MS);
    })();

    return () => {
      stopped = true;
      if (watchTimer) clearTimeout(watchTimer);
      if (rescanTimer) clearTimeout(rescanTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [granted]);

  const chooseFolder = useCallback(async () => {
    if (!projectKey) return;
    try {
      const handle = await (window as unknown as Picker).showDirectoryPicker({
        id: "scaid-scad-view",
        mode: "read",
      });
      folderRef.current = handle;
      seenRef.current = null;
      setFolderName(handle.name);
      setPinned(null);
      setCurrent(null);
      setFiles([]);
      setError(null);
      setGranted(true);
      void rememberFolder(projectKey, handle);
    } catch {
      // Dismissing the dialog is a decision, not a failure.
    }
  }, [projectKey]);

  const grant = useCallback(async () => {
    const handle = folderRef.current;
    if (!handle) return;
    const permission = (await handle.requestPermission?.({ mode: "read" })) ?? "denied";
    if (permission === "granted") {
      seenRef.current = null;
      setGranted(true);
      setError(null);
      return;
    }
    setError("Reading that folder was declined. Pick it again to start over.");
  }, []);

  const forget = useCallback(async () => {
    if (!projectKey) return;
    folderRef.current = null;
    seenRef.current = null;
    setGranted(false);
    setFolderName(null);
    setFiles([]);
    setCurrent(null);
    setPinned(null);
    setError(null);
    await forgetFolder(projectKey);
  }, [projectKey]);

  const state: Watching = !canWatch
    ? "unsupported"
    : granted
      ? "watching"
      : folderName
        ? "needs-permission"
        : "idle";

  return {
    state,
    folderName,
    files,
    pinned,
    current,
    error,
    chooseFolder,
    grant,
    pin: setPinned,
    forget,
  };
}
