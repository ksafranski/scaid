/**
 * OpenSCAD's compiler output is written for engineers. Kids get a plain-language
 * version instead, with the raw text still available behind a "show me the details" toggle.
 */
const PATTERNS: Array<{ test: RegExp; message: string }> = [
  {
    test: /Parser error|syntax error/i,
    message: "I made a typo while writing the shape. Ask me to try again and I'll fix it!",
  },
  {
    test: /Unknown module|Ignoring unknown module/i,
    message: "I tried to use a building block that doesn't exist here. Ask me to try a simpler way!",
  },
  {
    test: /Unknown variable|Ignoring unknown variable/i,
    message: "I used a measurement I forgot to write down. Ask me to try again!",
  },
  {
    test: /can't open input file|No such file/i,
    message: "I tried to borrow a part from somewhere else, but I have to build everything myself here.",
  },
  {
    test: /Object may not be a valid 2-manifold|not a valid 2-manifold/i,
    message:
      "Some pieces are only just touching, so the shape isn't solid. Ask me to make the parts overlap a bit more!",
  },
  {
    test: /out of memory|Allocation failed/i,
    message: "That shape got too big for me to build. Ask me to make it simpler or smaller!",
  },
];

export function friendlyError(raw: string): string {
  for (const { test, message } of PATTERNS) {
    if (test.test(raw)) return message;
  }
  return "Something went wrong while building that shape. Ask me to try again!";
}
