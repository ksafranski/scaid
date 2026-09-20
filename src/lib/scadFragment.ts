/**
 * The program, carried in the URL's fragment.
 *
 * This is how the Claude Code plugin gets a design onto the page, and it is the whole reason
 * the viewer needs no permissions: a fragment is the one part of a URL the browser never
 * sends to the server, so handing the page a file this way keeps the code on the machine it
 * came from while skipping the file dialog entirely.
 *
 * The file's path rides along too, for the same reason — putting it in the query string
 * would write somebody's directory layout into a hosting provider's access log.
 *
 * Gzip first, because the fragment is the budget: a 2.5kB program becomes about 1.4kB of
 * URL rather than 3.4kB, and the awkward files are the long ones.
 */

/** Refuses anything implausible before it becomes a render. Matches the editor's own ceiling. */
const MAX_CHARS = 200_000;

export interface FragmentSource {
  code: string;
  /** Where the file lives, as the plugin saw it. Null when nothing said. */
  path: string | null;
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes as unknown as BufferSource);
}

/**
 * Reads a program out of `location.hash`, or null if there isn't one.
 *
 * Every failure is the same answer — null — because there is exactly one useful response to
 * a fragment that won't decode, and it's to behave as though the page were opened without
 * one. A half-decoded program is not a better outcome than an empty viewer.
 */
export async function readFragment(hash: string): Promise<FragmentSource | null> {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const packed = params.get("c");
  if (!packed) return null;

  try {
    const bytes = fromBase64Url(packed);

    // Streams rather than a library: gzip is built into the browser, and pulling in an
    // inflate implementation to save nothing would be the only dependency on this path.
    const stream = new Blob([bytes as unknown as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const code = await new Response(stream).text();
    if (!code.trim() || code.length > MAX_CHARS) return null;

    const rawPath = params.get("f");
    const path = rawPath ? toText(fromBase64Url(rawPath)).slice(0, 4096) : null;

    return { code, path: path || null };
  } catch {
    return null;
  }
}

/** Whether this browser can read one at all. Safari got it in 16.4; everything else is older. */
export function canReadFragments(): boolean {
  return typeof DecompressionStream !== "undefined";
}

/** The last segment of a path, for showing which file is on screen. */
export function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}
