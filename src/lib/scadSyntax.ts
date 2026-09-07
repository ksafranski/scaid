/**
 * Is this code finished enough to be worth compiling?
 *
 * Half-typed code is the normal state of an editor, not a mistake. `cube(10` isn't wrong,
 * it's unfinished — and compiling it produces a syntax error that says nothing useful and
 * flashes red while someone is still mid-thought.
 *
 * So the editor asks here first and simply doesn't render until the answer is yes. This
 * only catches *structural* incompleteness, which is what typing produces; a genuine
 * mistake in complete code still goes to OpenSCAD, whose error is the one worth showing.
 */

const CLOSERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/**
 * What the code is still waiting for, phrased to drop into "Waiting for …", or null when
 * it's structurally complete.
 *
 * Unbalanced the other way — a `}` too many — is a real mistake rather than an unfinished
 * one, so it returns null and lets the compiler say so properly.
 */
export function incompleteReason(code: string): string | null {
  const stack: string[] = [];
  let index = 0;

  while (index < code.length) {
    const char = code[index];
    const pair = code.slice(index, index + 2);

    if (pair === "//") {
      const end = code.indexOf("\n", index);
      if (end === -1) break; // a trailing line comment ends the file cleanly
      index = end + 1;
      continue;
    }

    if (pair === "/*") {
      const end = code.indexOf("*/", index + 2);
      if (end === -1) return "the end of a comment";
      index = end + 2;
      continue;
    }

    if (char === '"') {
      index += 1;
      let closed = false;
      while (index < code.length) {
        if (code[index] === "\\") {
          index += 2;
          continue;
        }
        if (code[index] === '"') {
          closed = true;
          index += 1;
          break;
        }
        index += 1;
      }
      if (!closed) return "a closing quote";
      continue;
    }

    if (CLOSERS[char]) stack.push(CLOSERS[char]);
    else if (char === ")" || char === "]" || char === "}") {
      // A stray or mismatched closer is a real error, not an unfinished one. Hand it to the
      // compiler, which can point at the line.
      if (stack.pop() !== char) return null;
    }

    index += 1;
  }

  const open = stack.pop();
  return open ? `a closing ${open}` : null;
}
