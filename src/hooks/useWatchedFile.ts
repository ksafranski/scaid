"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBrowserOnly } from "./useBrowserOnly";
import { forgetFile, lastUsedFile, recallFile, rememberFile } from "@/lib/handleStore";
import { basename, changed, type ScadFileHandle } from "@/lib/scadFiles";

/**
 * How often the file is checked for a new modification time.
 *
 * A metadata read against the local disk, not a network request, so it can be quick without
 * costing anything — and a render takes longer than this anyway.
 */
const WATCH_MS = 400;

export type Watching =
  /** This browser can't open a file this way at all. */
  | "unsupported"
  /** Nothing opened yet, and nothing remembered for this path. */
  | "idle"
  /** Seen before, but the browser wants the person to allow reading it again. */
  | "needs-permission"
  | "watching";

export interface WatchedFile {
  state: Watching;
  /** The file's own name, once something is open. */
  name: string | null;
  /** The contents as of the last save. */
  code: string | null;
  /**
   * Set when the file that got opened isn't the one the URL asked for.
   *
   * A page can't read a handle's path, only its name, so this is the most that can be
   * checked — but it catches the common slip of picking the wrong thing in the dialog.
   */
  mismatch: string | null;
  error: string | null;

  choose: () => Promise<void>;
  grant: () => Promise<void>;
  forget: () => Promise<void>;
}

const supported = () => typeof window !== "undefined" && "showOpenFilePicker" in window;
const unsupportedOnServer = () => false;

interface Picker {
  showOpenFilePicker(options?: {
    id?: string;
    multiple?: boolean;
    startIn?: ScadFileHandle;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }): Promise<ScadFileHandle[]>;
}

/** What the dialog offers, so a project full of other files doesn't get in the way. */
const SCAD_ONLY = [
  { description: "OpenSCAD", accept: { "text/plain": [".scad"], "application/x-openscad": [".scad"] } },
];

/**
 * Watches one file on disk and hands back its contents.
 *
 * There is no server in this and nothing leaves the machine: the page reads the file itself,
 * through access the person granted to that one file, and notices saves by watching its
 * modification time. Whatever writes the file needs to know nothing about any of it.
 *
 * `path` is where the file is expected to be — used to remember the handle, and to notice
 * when the wrong file got picked. Null before the browser has read it out of the URL.
 */
export function useWatchedFile(path: string | null): WatchedFile {
  const canWatch = useBrowserOnly(supported, unsupportedOnServer);

  const [name, setName] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The live handle. A ref because the polling loop reads it and shouldn't restart on it. */
  const handleRef = useRef<ScadFileHandle | null>(null);
  /** What the file looked like last time, so an untouched file costs one stat and no read. */
  const seenRef = useRef<{ lastModified: number; size: number } | null>(null);

  // A handle remembered from last time. Its name is readable without permission, so the
  // button can say which file it is before anyone clicks anything.
  useEffect(() => {
    if (!canWatch || !path) return;
    let cancelled = false;

    void (async () => {
      const handle = await recallFile(path);
      if (cancelled || !handle) return;

      handleRef.current = handle;
      seenRef.current = null;
      setName(handle.name);

      const permission = (await handle.queryPermission?.({ mode: "read" })) ?? "prompt";
      if (!cancelled && permission === "granted") setGranted(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [canWatch, path]);

  useEffect(() => {
    if (!granted) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const idle = () => typeof document !== "undefined" && document.hidden;

    async function check() {
      const handle = handleRef.current;
      if (stopped || !handle) return;

      try {
        const file = await handle.getFile();
        if (stopped) return;

        if (!changed(file, seenRef.current)) return;

        const text = await file.text();
        if (stopped) return;

        seenRef.current = { lastModified: file.lastModified, size: file.size };
        // Compared rather than assumed: a save that didn't alter anything shouldn't throw
        // away a section or a measurement someone has open.
        setCode((prev) => (prev === text ? prev : text));
        setError(null);
      } catch {
        // Usually the file was renamed or deleted out from under us. Say so once rather than
        // every 400ms, and leave the last good model on screen.
        seenRef.current = null;
        setError((prev) => prev ?? "Can't read that file any more — it may have moved.");
      }
    }

    const loop = async () => {
      if (!idle()) await check();
      if (!stopped) timer = setTimeout(loop, WATCH_MS);
    };

    // Coming back to the tab shouldn't wait out an interval to catch up.
    const onVisible = () => {
      if (!idle()) void check();
    };
    document.addEventListener("visibilitychange", onVisible);

    // The first read runs whether or not anyone is looking, so a tab opened in the
    // background already has the model on it by the time it's switched to.
    void (async () => {
      await check();
      if (!stopped) timer = setTimeout(loop, WATCH_MS);
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [granted]);

  const choose = useCallback(async () => {
    if (!path) return;
    try {
      const [handle] = await (window as unknown as Picker).showOpenFilePicker({
        id: "scaid-scad-view",
        multiple: false,
        types: SCAD_ONLY,
        // Start where the last file came from. The browser also remembers a directory per
        // `id`, but an explicit handle beats it when both are available.
        startIn: (await lastUsedFile()) ?? undefined,
      });
      if (!handle) return;

      handleRef.current = handle;
      seenRef.current = null;
      setName(handle.name);
      setCode(null);
      setError(null);
      setMismatch(handle.name === basename(path) ? null : basename(path));
      setGranted(true);
      void rememberFile(path, handle);
    } catch {
      // Dismissing the dialog is a decision, not a failure.
    }
  }, [path]);

  const grant = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;
    const permission = (await handle.requestPermission?.({ mode: "read" })) ?? "denied";
    if (permission === "granted") {
      seenRef.current = null;
      setGranted(true);
      setError(null);
      return;
    }
    setError("Reading that file was declined. Open it again to start over.");
  }, []);

  const forget = useCallback(async () => {
    if (!path) return;
    handleRef.current = null;
    seenRef.current = null;
    setGranted(false);
    setName(null);
    setCode(null);
    setMismatch(null);
    setError(null);
    await forgetFile(path);
  }, [path]);

  const state: Watching = !canWatch
    ? "unsupported"
    : granted
      ? "watching"
      : name
        ? "needs-permission"
        : "idle";

  return { state, name, code, mismatch, error, choose, grant, forget };
}
