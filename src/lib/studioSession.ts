/**
 * Keeps work-in-progress alive across navigation and reloads.
 *
 * Visiting the Library unmounts the studio, so without this an unsaved build — the
 * conversation, the design, any hand-edits to the code — is gone the moment someone looks
 * at their library and comes back.
 *
 * sessionStorage rather than localStorage: this is scratch work for the current tab, not
 * something that should resurface days later next to a different build.
 */
import type { BuildStep } from "./types";

const KEY = "scaid.studioSession";

/** Roughly 4MB of UTF-16; well under the ~5MB budget, with room for the rest of the app. */
const MAX_CHARS = 2_000_000;

export interface StoredDesign {
  name: string;
  description?: string;
  summary: string;
  steps: BuildStep[];
  code: string;
}

export interface StudioSnapshot {
  messages: unknown[];
  design: StoredDesign | null;
  savedId: string | null;
  lastPrompt: string;
  /** The maker's own write-up. Absent on a session stored before readmes existed. */
  readme?: string;
  view: "chat" | "code" | "readme";
  saved: boolean;
}

export function saveSession(snapshot: StudioSnapshot): void {
  try {
    let payload = JSON.stringify(snapshot);

    // Attached photos are the only thing here big enough to blow the quota. If we're near
    // it, drop the thumbnails rather than lose the whole session.
    if (payload.length > MAX_CHARS) {
      const lean = {
        ...snapshot,
        messages: snapshot.messages.map((message) =>
          message && typeof message === "object" && "imageUrl" in message
            ? { ...(message as Record<string, unknown>), imageUrl: undefined }
            : message,
        ),
      };
      payload = JSON.stringify(lean);
    }

    sessionStorage.setItem(KEY, payload);
  } catch {
    // Quota or private browsing. Losing the restore is better than breaking the studio.
  }
}

export function loadSession(): StudioSnapshot | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StudioSnapshot;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Forgets the stored session if it's the build that was just deleted, so returning to the
 * studio starts fresh instead of reopening something that no longer exists and can't be saved.
 */
export function forgetIfSaved(creationId: string): void {
  const snapshot = loadSession();
  if (snapshot?.savedId === creationId) clearSession();
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do; a stale session is harmless.
  }
}
