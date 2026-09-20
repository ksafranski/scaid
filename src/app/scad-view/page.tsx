import type { Metadata } from "next";
import { ScadView } from "@/components/ScadView";

export const metadata: Metadata = {
  title: "Scaid — live view",
  description: "Watch an OpenSCAD file build as your editor writes it.",
  robots: { index: false, follow: false },
};

/**
 * The live view.
 *
 * A static page, and deliberately so: there is no `requireUser`, no database, no API behind
 * it, and nothing for a server to decide. Everything it shows is read off the visitor's own
 * disk in the browser, so this route is a file on a CDN — which is what makes hosting the
 * live view free.
 *
 * That's also why `?dir=` — the Claude Code plugin's hint about which project the tab is
 * for — is read in the browser rather than from `searchParams`: taking it here would make
 * the page render per request for a value the server does nothing with.
 */
export default function ScadViewPage() {
  return <ScadView />;
}
