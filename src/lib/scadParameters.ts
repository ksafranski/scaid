/**
 * The numbers at the top of a program, and the controls they become.
 *
 * A model whose sizes are written into the middle of it can only be changed by rewriting
 * it. The same model with its sizes named at the top can be changed by moving a slider —
 * which is the whole difference between a shape someone was handed and a shape they own.
 *
 * This reads OpenSCAD's own Customizer convention, so the programs stay ordinary OpenSCAD:
 * open one in the real thing and the same controls are there. Nothing here is a Scaid
 * dialect.
 *
 *     /* [Size] *\/
 *     height = 80;     // How tall it stands [40:200]
 *     wall  = 2.5;     // Wall thickness [1:0.1:5]
 *     lid   = true;    // Put a lid on it
 *
 * Values are written back into the source rather than passed to the compiler separately.
 * That costs a little more work here and removes a whole category of bug: there is one
 * copy of every number, so the code you read, the model you see, the STL you download and
 * the program the agent is handed next turn can never disagree about how tall it is.
 */

export type ParameterKind = "number" | "boolean" | "option";

export interface ParameterOption {
  value: number | string;
  label: string;
}

export interface Parameter {
  /** The variable's name in the program. */
  name: string;
  /** What to call it on screen: its comment, or its name made readable. */
  label: string;
  kind: ParameterKind;
  value: number | boolean | string;
  /** Numbers only. Absent when the program didn't say, which means no slider. */
  min?: number;
  max?: number;
  step?: number;
  /** Options only. */
  options?: ParameterOption[];
  /** The heading it appeared under, from a `/* [Name] *\/` line. */
  group?: string;
  /** Where the value itself sits in the source, so it can be replaced exactly. */
  start: number;
  end: number;
}

/** A number, `true`/`false`, or a double-quoted string — nothing that could be an expression. */
const ASSIGNMENT =
  /^(\s*)([A-Za-z_]\w*)(\s*=\s*)(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|true|false|"[^"\\]*")(\s*;)/;

/** `/* [Anything] *\/` on a line of its own. */
const GROUP = /^\s*\/\*\s*\[([^\]]+)\]\s*\*\/\s*$/;

/** The bracketed part of a trailing comment: a range, a step range, or a list. */
const SPEC = /\[([^\]]*)\]\s*$/;

/**
 * Everything past here is the program rather than its controls.
 *
 * Scanning stops at the first real statement, so a variable used as working scratch
 * halfway down a module never turns into a dial someone can drag. The agent is told to
 * put the adjustable numbers at the top, and this is the line that makes that mean
 * something.
 */
function isParameterLine(line: string): boolean {
  const bare = line.trim();
  if (!bare) return true;
  if (bare.startsWith("//") || bare.startsWith("/*") || bare.startsWith("*")) return true;
  return ASSIGNMENT.test(line);
}

export function parseParameters(code: string): Parameter[] {
  const parameters: Parameter[] = [];
  const lines = code.split("\n");

  let offset = 0;
  let group: string | undefined;

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1; // the newline split() removed

    const heading = GROUP.exec(line);
    if (heading) {
      const name = heading[1].trim();
      // The Customizer's own word for "these are not for showing".
      if (/^hidden$/i.test(name)) break;
      group = name;
      continue;
    }

    if (!isParameterLine(line)) break;

    const match = ASSIGNMENT.exec(line);
    if (!match) continue;

    const [, indent, name, equals, literal] = match;
    // Special variables are the renderer's settings, not the model's dimensions.
    if (name.startsWith("$")) continue;

    const valueStart = lineStart + indent.length + name.length + equals.length;
    const comment = line.slice(match[0].length);
    const parameter = describe(name, literal, comment, group, valueStart);
    if (parameter) parameters.push(parameter);
  }

  return parameters;
}

function describe(
  name: string,
  literal: string,
  comment: string,
  group: string | undefined,
  valueStart: number,
): Parameter | null {
  const base = {
    name,
    group,
    start: valueStart,
    end: valueStart + literal.length,
  };

  const said = /^\s*\/\/(.*)$/.exec(comment)?.[1]?.trim() ?? "";
  const spec = SPEC.exec(said);
  const label = readableLabel(said.replace(SPEC, "").trim(), name);

  if (literal === "true" || literal === "false") {
    return { ...base, kind: "boolean", label, value: literal === "true" };
  }

  if (literal.startsWith('"')) {
    const value = literal.slice(1, -1);
    const options = spec ? readOptions(spec[1]) : null;
    // A string with nothing to choose between isn't a control, it's a note to self.
    if (!options?.length) return null;
    return { ...base, kind: "option", label, value, options };
  }

  const value = Number(literal);
  if (!Number.isFinite(value)) return null;

  if (spec) {
    const options = spec[1].includes(",") ? readOptions(spec[1]) : null;
    if (options?.length) return { ...base, kind: "option", label, value, options };

    const range = readRange(spec[1]);
    if (range) return { ...base, kind: "number", label, value, ...range };
  }

  // No range given, so it gets a box to type in rather than a slider to drag. Showing it
  // anyway matters: a number that silently vanished would look like a bug in the model.
  return { ...base, kind: "number", label, value };
}

/** `min:max` or `min:step:max`, the way OpenSCAD's Customizer writes them. */
function readRange(spec: string): { min: number; max: number; step?: number } | null {
  const parts = spec.split(":").map((part) => Number(part.trim()));
  if (parts.some((part) => !Number.isFinite(part))) return null;

  if (parts.length === 2) return { min: parts[0], max: parts[1] };
  if (parts.length === 3) return { min: parts[0], max: parts[2], step: parts[1] };
  return null;
}

/** `a, b, c` or `1:One, 2:Two`. */
function readOptions(spec: string): ParameterOption[] {
  return spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [raw, ...rest] = entry.split(":");
      const text = raw.trim().replace(/^"|"$/g, "");
      const value = Number(text);
      return {
        value: rest.length === 0 && !Number.isFinite(value) ? text : Number.isFinite(value) ? value : text,
        label: rest.length ? rest.join(":").trim() : text,
      };
    });
}

/** `floor_thickness` becomes "Floor thickness" when the program didn't say otherwise. */
function readableLabel(said: string, name: string): string {
  if (said) return said;
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The program with one value replaced.
 *
 * Replaces exactly the literal the parse found and leaves every other character alone, so
 * a person's own comments, spacing and formatting survive being dialled. Returns the code
 * untouched if the value isn't one this module would have offered — nothing here writes
 * something it couldn't read back.
 */
export function setParameter(
  code: string,
  name: string,
  value: number | boolean | string,
): string {
  const parameter = parseParameters(code).find((candidate) => candidate.name === name);
  if (!parameter) return code;

  const literal = toLiteral(value, parameter.kind);
  if (literal === null) return code;

  return code.slice(0, parameter.start) + literal + code.slice(parameter.end);
}

/**
 * A value as source text, or null if it has no business being there.
 *
 * The gate, and the reason it's a gate: this text is compiled. A value carrying a
 * semicolon would be two statements rather than one number, and a value that isn't a
 * number at all becomes `undef`, which OpenSCAD renders as a silently wrong shape rather
 * than an error. So nothing reaches the program that didn't survive being parsed as the
 * kind of thing it claims to be.
 */
function toLiteral(value: number | boolean | string, kind: ParameterKind): string | null {
  if (kind === "boolean") return value ? "true" : "false";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // Trims the float noise a slider produces without touching a number someone typed.
    return String(Number(value.toFixed(4)));
  }

  if (kind === "option" && typeof value === "string") {
    // Quoted, and only ever containing what a quoted string may contain.
    if (/["\\\n]/.test(value)) return null;
    return `"${value}"`;
  }

  return null;
}

/**
 * How far one nudge of a control should move, when the program didn't say.
 *
 * A whole number between whole bounds is a count of something — grooves, sides, ribs — and
 * half of one is not a thing that exists. Anything written with a decimal point is a
 * measurement, where halves and tenths are exactly what someone wants to reach for.
 *
 * A program that wants finer than this says so: `[0.3:0.1:2]` is always obeyed.
 */
export function stepFor(parameter: Parameter): number {
  if (parameter.step !== undefined) return parameter.step;
  if (parameter.min === undefined || parameter.max === undefined) return 1;

  const counts =
    Number.isInteger(parameter.value as number) &&
    Number.isInteger(parameter.min) &&
    Number.isInteger(parameter.max);
  if (counts) return 1;

  const span = parameter.max - parameter.min;
  if (span <= 5) return 0.1;
  if (span <= 50) return 0.5;
  return 1;
}

/** Keeps the program's own order while collecting the controls under their headings. */
export function groupParameters(
  parameters: Parameter[],
): Array<{ group: string | undefined; parameters: Parameter[] }> {
  const groups: Array<{ group: string | undefined; parameters: Parameter[] }> = [];
  for (const parameter of parameters) {
    const last = groups[groups.length - 1];
    if (last && last.group === parameter.group) last.parameters.push(parameter);
    else groups.push({ group: parameter.group, parameters: [parameter] });
  }
  return groups;
}
