"use client";

import { useSyncExternalStore } from "react";

/** Nothing to subscribe to: these values are read once and don't change under us. */
const never = () => () => {};

/**
 * A value that only exists in the browser — the page's origin, something in localStorage,
 * an id minted on first use.
 *
 * Reading any of these during render makes the server's markup and the client's disagree,
 * and reading them in an effect means a second render on every mount and a lint rule
 * telling you so. `useSyncExternalStore` is built for exactly this: it serves the server
 * snapshot through hydration and the real one immediately afterwards, in one pass.
 *
 * Both functions have to live outside the component and return a stable value — React
 * compares snapshots with `Object.is` and will spin forever on one that's freshly built
 * every call.
 */
export function useBrowserOnly<T>(getSnapshot: () => T, getServerSnapshot: () => T): T {
  return useSyncExternalStore(never, getSnapshot, getServerSnapshot);
}
