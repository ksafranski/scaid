"use client";

import { Cube } from "@phosphor-icons/react";

/**
 * The Scaid mark. The same cube is the favicon, the installed-app icon and the wordmark
 * glyph, so the app is recognizable in a tab strip and on a home screen alike.
 */
export function Logo({ size = 22, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Cube size={size} weight="duotone" className="shrink-0 text-volt-400" aria-hidden />
      {withWordmark && <span className="font-display font-bold tracking-tight">Scaid</span>}
    </span>
  );
}
