/**
 * A small OpenSCAD tokenizer for the code viewer.
 *
 * No off-the-shelf highlighter ships an OpenSCAD grammar except Shiki, which would mean
 * shipping a grammar, a theme and a regex engine to color a few hundred bytes of code.
 * OpenSCAD's lexical surface is tiny and the agent only emits core built-ins, so a scanner
 * covers it — and lets the colors mean something to a beginner: shapes read differently
 * from the things that move shapes around, and comments stay bright because in this app the
 * comments are the explanation.
 */

export type TokenKind =
  | "comment"
  | "string"
  | "number"
  | "special"
  | "keyword"
  | "shape"
  | "action"
  | "punct"
  | "plain";

export interface Token {
  text: string;
  kind: TokenKind;
}

/** Things that make a shape out of nothing. */
const SHAPES = new Set([
  "cube", "sphere", "cylinder", "polyhedron",
  "square", "circle", "polygon", "text",
  "surface", "import",
]);

/** Things that move, combine or change shapes that already exist. */
const ACTIONS = new Set([
  "translate", "rotate", "scale", "resize", "mirror", "multmatrix",
  "union", "difference", "intersection", "hull", "minkowski",
  "linear_extrude", "rotate_extrude", "projection", "offset",
  "color", "render", "children", "child",
]);

const KEYWORDS = new Set([
  "module", "function", "if", "else", "for", "intersection_for",
  "let", "assert", "echo", "each", "include", "use",
  "true", "false", "undef",
]);

// Order matters: comments and strings must win before anything inside them is scanned.
const SCANNER = new RegExp(
  [
    "(?<comment>//[^\\n]*|/\\*[\\s\\S]*?\\*/|/\\*[\\s\\S]*)",
    '(?<string>"(?:[^"\\\\\\n]|\\\\.)*")',
    "(?<special>\\$[A-Za-z_]\\w*)",
    "(?<number>\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|\\.\\d+)",
    "(?<word>[A-Za-z_]\\w*)",
    "(?<punct>[{}()\\[\\];,:?=<>!+\\-*/%&|^~.]+)",
  ].join("|"),
  "g",
);

function classifyWord(word: string): TokenKind {
  if (KEYWORDS.has(word)) return "keyword";
  if (SHAPES.has(word)) return "shape";
  if (ACTIONS.has(word)) return "action";
  return "plain";
}

export function tokenizeScad(code: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;

  const push = (text: string, kind: TokenKind) => {
    if (!text) return;
    // Merge runs of the same kind so React renders fewer spans.
    const previous = tokens[tokens.length - 1];
    if (previous && previous.kind === kind) previous.text += text;
    else tokens.push({ text, kind });
  };

  SCANNER.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SCANNER.exec(code)) !== null) {
    // Whitespace and anything the scanner doesn't recognise passes through untouched.
    push(code.slice(lastIndex, match.index), "plain");
    lastIndex = match.index + match[0].length;

    const groups = match.groups!;
    if (groups.comment) push(groups.comment, "comment");
    else if (groups.string) push(groups.string, "string");
    else if (groups.special) push(groups.special, "special");
    else if (groups.number) push(groups.number, "number");
    else if (groups.word) push(groups.word, classifyWord(groups.word));
    else if (groups.punct) push(groups.punct, "punct");
  }

  push(code.slice(lastIndex), "plain");
  return tokens;
}
