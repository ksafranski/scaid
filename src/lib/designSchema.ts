import { z } from "zod";
import { FALLBACK_ICON, ICON_NAMES } from "@/lib/iconNames";

/**
 * The fields of the design response that name one of a fixed set of things.
 *
 * These are deliberately forgiving, and the reason is worth writing down. Structured
 * output does not constrain a model to an enum the way it constrains a type: the allowed
 * values travel to it as a line of description, which is guidance rather than a rail. So a
 * word outside the set is a thing that happens, and it happened — a build came back with
 * an icon nobody had heard of.
 *
 * What made that bad was not the wrong icon. `StepIcon` has drawn an unrecognised name as
 * the fallback since the day icons were added, so the interface never cared. It was that
 * validation threw, which threw away the whole response: a finished program, the steps,
 * the summary, a minute of someone's time, all discarded over a label the screen was
 * already prepared to ignore.
 *
 * So a value outside the set is corrected here instead of being fatal, and logged, because
 * one stray icon is noise and the same wrong one every time is a prompt that needs fixing.
 */

/**
 * One of the drawn icons, or the fallback the interface would have used anyway.
 *
 * The fallback has to be a plain value rather than a function, even though a function
 * could log what came in. Handing `.catch()` a function makes the schema impossible to
 * express as JSON Schema, and the request then fails before it is sent — trading a rare
 * lost build for every build. `reportIconDrift` does the reporting instead.
 */
export const IconField = z.enum(ICON_NAMES).catch(FALLBACK_ICON);

/**
 * Says so when a model asked for an icon that doesn't exist.
 *
 * Read off the raw response rather than the parsed one, because by then the value has
 * already been quietly corrected. One stray name is noise; the same one every time is a
 * prompt that needs a word changing, and without this there would be nothing to notice.
 */
export function reportIconDrift(rawJson: string): string[] {
  const offered = [...rawJson.matchAll(/"icon"\s*:\s*"([^"]*)"/g)].map((match) => match[1]);
  const strays = [...new Set(offered)].filter(
    (name) => !(ICON_NAMES as readonly string[]).includes(name),
  );
  if (strays.length) {
    console.warn(
      `[design] icons that aren't ours: ${strays.join(", ")} — drawn as ${FALLBACK_ICON}`,
    );
  }
  return strays;
}

/**
 * Whether this turn asks a question or builds something.
 *
 * Falls back to building, which is what the system prompt tells it to do in almost every
 * case — and a build that arrives when a question was meant is a far smaller failure than
 * losing the turn.
 */
export const ActionField = z.enum(["ask", "build"]).catch("build");
