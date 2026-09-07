/**
 * Pulls the line number out of an OpenSCAD compiler message so the editor can point at it.
 *
 * Messages look like: "ERROR: Parser error: syntax error in file /input.scad, line 12"
 */
export function errorLine(detail: string): number | null {
  const match = /line (\d+)/.exec(detail);
  if (!match) return null;
  const line = Number(match[1]);
  return Number.isFinite(line) && line > 0 ? line : null;
}

/** The first message worth showing, stripped of the temp-file path noise. */
export function firstProblem(detail: string): string {
  const line =
    detail.split("\n").find((l) => l.includes("ERROR:")) ??
    detail.split("\n").find((l) => l.includes("WARNING:")) ??
    detail.split("\n")[0] ??
    "";
  return line
    .replace(/^(ERROR|WARNING):\s*/, "")
    // The line number is shown separately, so drop it from the message body.
    .replace(/\s*in file \/input\.scad,?\s*line \d+\.?/, "")
    .replace(/,?\s*line \d+\.?$/, "")
    .trim();
}
