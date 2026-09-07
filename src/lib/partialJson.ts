/**
 * Reads fields out of structured output while it is still streaming.
 *
 * Structured outputs arrive as a text block containing JSON, generated in schema order — so
 * `plan`, then `name`, then each step, then the code. That ordering is what makes real
 * progress reporting possible: by the time the code starts, every part has already been
 * named, and we can report each one the moment it lands.
 *
 * Values are only reported once their closing quote has arrived, so the UI never shows half
 * a word. Everything here is deliberately regex-shaped rather than a real incremental JSON
 * parser: we want four known keys out of a known schema, not a general parser.
 */
import { isIconName, type IconName } from "./iconNames";

/** A complete JSON string body: any run of non-quote/backslash chars, or an escape pair. */
const STRING_BODY = String.raw`((?:[^"\\]|\\.)*)`;

function keyPattern(key: string, flags = ""): RegExp {
  return new RegExp(String.raw`"${key}"\s*:\s*"${STRING_BODY}"`, flags);
}

/** Turns a raw (still-escaped) JSON string body into its real text. */
function unescape(raw: string): string | null {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return null;
  }
}

/**
 * Where the code field starts, or the end of the text.
 *
 * Everything is scanned only up to here. `code` is last in the schema and is the one field
 * that could plausibly contain the literal text `"title":`, which would otherwise be picked
 * up as another part.
 */
function scanLimit(json: string): number {
  const start = json.indexOf('"code"');
  return start === -1 ? json.length : start;
}

export interface StreamedPart {
  index: number;
  icon: IconName;
  title: string;
}

/**
 * Tracks what has already been reported, so each field is emitted exactly once.
 *
 * Fed the whole accumulated text each time rather than deltas — a field's closing quote can
 * land in a different chunk from its opening one, so incremental matching against fragments
 * would miss values that span a chunk boundary.
 */
export class StreamedFields {
  private sent = new Set<string>();
  private partCount = 0;
  private lineCount = 0;

  /** A top-level string field, reported once, as soon as it is complete. */
  private once(json: string, key: string): string | null {
    if (this.sent.has(key)) return null;
    const match = keyPattern(key).exec(json.slice(0, scanLimit(json)));
    if (!match) return null;
    this.sent.add(key);
    return unescape(match[1]);
  }

  /** The approach, once the model has committed to it. */
  plan(json: string): string | null {
    return this.once(json, "plan");
  }

  name(json: string): string | null {
    return this.once(json, "name");
  }

  /** A repair's explanation, which lands before the corrected code. */
  note(json: string): string | null {
    return this.once(json, "note");
  }

  /**
   * Parts named since the last call.
   *
   * A part is only reported once both its icon and its title are complete, which keeps the
   * icon and the words appearing together instead of an icon sitting alone for a token or two.
   */
  parts(json: string): StreamedPart[] {
    const scope = json.slice(0, scanLimit(json));
    const pattern = new RegExp(
      String.raw`"icon"\s*:\s*"([a-z]+)"\s*,\s*"title"\s*:\s*"${STRING_BODY}"`,
      "g",
    );

    const fresh: StreamedPart[] = [];
    let match: RegExpExecArray | null;
    let seen = 0;

    while ((match = pattern.exec(scope)) !== null) {
      const index = seen++;
      if (index < this.partCount) continue;

      const title = unescape(match[2]);
      if (!title || !isIconName(match[1])) continue;

      this.partCount = index + 1;
      fresh.push({ index, icon: match[1], title });
    }

    return fresh;
  }

  /**
   * How many lines of code exist so far, or null if that hasn't moved.
   *
   * The code is one JSON string, so its line breaks are the two characters `\n` rather than
   * real newlines. Counting those is exact, not an estimate.
   */
  lines(json: string): number | null {
    const start = json.indexOf('"code"');
    if (start === -1) return null;

    const count = (json.slice(start).match(/\\n/g) ?? []).length;
    if (count <= this.lineCount) return null;

    this.lineCount = count;
    return count;
  }
}
