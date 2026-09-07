/**
 * The wire protocol between the design agent and the studio.
 *
 * Newline-delimited JSON rather than SSE: the payload is already JSON, every event is a
 * single object, and `text/event-stream` would only add `data:` framing we'd immediately
 * strip back off. One object per line, parsed as lines complete.
 *
 * Every event describes work that has *actually happened* on the server. Nothing here is a
 * guess about progress — if we don't know, we don't send an event, and the UI falls back to
 * flavor text for the one genuinely opaque stretch (the model thinking before it writes).
 */
import type { IconName } from "./iconNames";
import type { BuildStep } from "./types";

/** What the agent is doing right now. The UI turns these into a line of copy. */
export type AgentStage =
  /** Waiting on the first token. We know nothing yet — this is the only opaque phase. */
  | "thinking"
  /** The approach has landed; parts are being named. */
  | "parts"
  /** Writing OpenSCAD. */
  | "writing"
  /** Deterministic checks over the finished code. */
  | "checking"
  /** Something was wrong and a second pass is fixing it. */
  | "fixing";

export interface AgentDesign {
  name: string;
  description: string;
  summary: string;
  steps: BuildStep[];
  code: string;
}

export type AgentEvent =
  | { t: "stage"; stage: AgentStage }
  /** The one-line approach, as soon as the model commits to it. */
  | { t: "plan"; plan: string }
  | { t: "name"; name: string }
  /** One part, the moment the model finishes naming it. Arrives before any code. */
  | { t: "part"; index: number; icon: IconName; title: string }
  /** Lines of OpenSCAD written so far. Counted from the stream, not estimated. */
  | { t: "lines"; count: number }
  /** Something worth saying that isn't a stage — a problem found and fixed. */
  | { t: "note"; text: string }
  | { t: "design"; design: AgentDesign }
  | { t: "error"; error: string };

export function encodeEvent(event: AgentEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Splits a byte stream into events.
 *
 * Chunk boundaries fall wherever the network puts them, so a line can arrive in pieces and
 * several lines can arrive at once. The trailing partial line is held back until its newline
 * shows up.
 */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // the last piece may not be a whole line yet

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line) as AgentEvent;
        } catch {
          // A malformed line is worth skipping, not worth failing the whole build over.
        }
      }
    }

    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer) as AgentEvent;
      } catch {
        // Stream ended mid-line — the caller's "never got a design" path handles it.
      }
    }
  } finally {
    reader.releaseLock();
  }
}
