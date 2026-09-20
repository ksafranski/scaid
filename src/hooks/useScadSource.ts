"use client";

import { useEffect, useState } from "react";
import { useBrowserOnly } from "./useBrowserOnly";
import { useWatchedFile, type WatchedFile } from "./useWatchedFile";
import { basename, canReadFragments, readFragment } from "@/lib/scadFragment";

/** Where the program on screen came from. */
export type Source = "fragment" | "file" | null;

export interface ScadSource {
  code: string | null;
  /** The file's name, however we learned it. */
  name: string | null;
  /** Its full path, when something told us. Also the key the watched handle is stored under. */
  path: string | null;
  source: Source;
  /** True once a fragment has ever arrived, so the page can stop offering instructions. */
  fromPlugin: boolean;
  /** The opt-in live watch, for when the file is being edited by hand rather than by Claude. */
  watch: WatchedFile;
}

/**
 * The program to show, from whichever source has one.
 *
 * The fragment is the everyday path: the Claude Code plugin puts the file in the URL, which
 * costs the person nothing — no dialog, no permission, no browser that has to be Chromium.
 * Re-opening with a new fragment doesn't reload the page, so a rebuild keeps the camera
 * where it was and never re-initialises nine megabytes of WebAssembly.
 *
 * Watching the file is the other path, for when something other than Claude is doing the
 * editing. It wins when it's on, because it is the one that updates by itself and nobody
 * turns it on by accident.
 */
export function useScadSource(): ScadSource {
  const [fragment, setFragment] = useState<{ code: string; path: string | null } | null>(null);
  const initialHash = useBrowserOnly(readHash, noHash);

  // The hash is read on arrival and again whenever it changes. That second case is the
  // interesting one: it's what a rebuild looks like, and it happens without a page load.
  useEffect(() => {
    let cancelled = false;

    const load = async (hash: string) => {
      const parsed = await readFragment(hash);
      if (cancelled || !parsed) return;
      setFragment((prev) =>
        prev && prev.code === parsed.code && prev.path === parsed.path ? prev : parsed,
      );
    };

    if (initialHash) void load(initialHash);

    const onHashChange = () => void load(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [initialHash]);

  // The watched file is keyed by the path the fragment named, so turning the watch on for a
  // file Claude sent, closing the tab and coming back recognises the same file.
  const watch = useWatchedFile(fragment?.path ?? null);

  const watching = watch.state === "watching" && watch.code !== null;

  return {
    code: watching ? watch.code : (fragment?.code ?? null),
    name: watching ? watch.name : (fragment?.path ? basename(fragment.path) : null),
    path: fragment?.path ?? null,
    source: watching ? "file" : fragment ? "fragment" : null,
    fromPlugin: fragment !== null,
    watch,
  };
}

const readHash = () => (canReadFragments() ? window.location.hash : "");
const noHash = () => "";
