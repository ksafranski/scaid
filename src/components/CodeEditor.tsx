"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle, Copy, PencilSimple, Warning } from "@phosphor-icons/react";
import { tokenizeScad, type TokenKind } from "@/lib/scadHighlight";
import { errorLine as lineOf, firstProblem } from "@/lib/scadErrors";

// Comments are deliberately the brightest thing here: in Scaid they carry the explanation,
// so they should read as content rather than as something dimmed out of the way.
const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: "text-emerald-400",
  string: "text-orange-300",
  number: "text-amber-400",
  special: "text-teal-300",
  keyword: "text-pink-400",
  shape: "text-cyan-400 font-semibold",
  action: "text-violet-400",
  punct: "text-mist-500",
  plain: "text-mist-100",
};

const LEGEND: Array<{ label: string; className: string }> = [
  { label: "shapes", className: "text-cyan-400" },
  { label: "moving & joining", className: "text-violet-400" },
  { label: "sizes", className: "text-amber-400" },
  { label: "notes", className: "text-emerald-400" },
];

/**
 * A syntax-highlighted editor built from a transparent <textarea> layered over a highlighted
 * <pre>. Both share identical font metrics, padding and scroll position, so the caret lands
 * exactly on the painted text.
 *
 * Deliberately not Monaco or CodeMirror: the files here are a few dozen lines, the value is
 * live feedback rather than IDE features, and this keeps the bundle small and the theme ours.
 */
export function CodeEditor({
  code,
  onChange,
  isRendering,
  error,
  incomplete = null,
  readOnly = false,
}: {
  code: string;
  onChange: (next: string) => void;
  isRendering: boolean;
  error: { friendly: string; detail: string } | null;
  /** What half-typed code is still waiting for, e.g. "a closing }". */
  incomplete?: string | null;
  readOnly?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const tokens = useMemo(() => tokenizeScad(code), [code]);
  const lineCount = useMemo(() => code.split("\n").length, [code]);
  const errorLine = error ? lineOf(error.detail) : null;

  /** Jump the caret to the offending line so the fix is one click away. */
  function goToErrorLine() {
    const textarea = textareaRef.current;
    if (!textarea || !errorLine) return;

    const lines = code.split("\n");
    const offset = lines.slice(0, errorLine - 1).reduce((total, line) => total + line.length + 1, 0);

    textarea.focus();
    textarea.setSelectionRange(offset, offset + (lines[errorLine - 1]?.length ?? 0));

    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 21;
    // Put the line a third of the way down rather than flush against the top edge.
    textarea.scrollTop = Math.max(0, (errorLine - 1) * lineHeight - textarea.clientHeight / 3);
    syncScroll();
  }

  // The painted layer and the gutter follow the textarea, which is the one that really scrolls.
  function syncScroll() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
  }

  useEffect(syncScroll, [code]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    // Tab should indent, not jump focus out of the editor mid-thought.
    event.preventDefault();
    const target = event.currentTarget;
    const { selectionStart, selectionEnd, value } = target;
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    onChange(next);
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = selectionStart + 2;
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the code is selectable either way.
    }
  }

  // One shared type ramp for the gutter, the painted code and the textarea.
  const typeStyle = "font-mono text-[13px] leading-[1.6]";

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 px-5 pb-2.5">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {LEGEND.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5 text-xs font-medium">
              {/* A dot plus a word, so the meaning doesn't depend on seeing color. */}
              <span aria-hidden className={item.className}>
                ●
              </span>
              <span className="text-mist-500">{item.label}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={copy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-mist-300 transition hover:border-ink-600 hover:text-mist-100"
        >
          {copied ? <Check size={13} weight="bold" /> : <Copy size={13} weight="duotone" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="mx-5 mb-5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-950">
        <div className="flex min-h-0 flex-1">
        {/* Line numbers, scrolled in step with the code. */}
        <div
          ref={gutterRef}
          aria-hidden
          className={`${typeStyle} shrink-0 overflow-hidden border-r border-ink-800 bg-ink-950 py-4 text-right select-none`}
          style={{ width: `${String(lineCount).length + 2}ch` }}
        >
          {Array.from({ length: lineCount }, (_, index) => (
            <div
              key={index}
              className={`px-2 ${errorLine === index + 1 ? "bg-rose-500/20 font-semibold text-rose-400" : "text-ink-500"}`}
            >
              {index + 1}
            </div>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <pre
            ref={highlightRef}
            aria-hidden
            className={`${typeStyle} pointer-events-none absolute inset-0 overflow-hidden p-4 whitespace-pre`}
          >
            <code>
              {tokens.map((token, index) => (
                <span key={index} className={TOKEN_CLASS[token.kind]}>
                  {token.text}
                </span>
              ))}
              {/* Trailing newline keeps the painted layer as tall as the textarea. */}
              {"\n"}
            </code>
          </pre>

          <textarea
            ref={textareaRef}
            value={code}
            onChange={(event) => onChange(event.target.value)}
            onScroll={syncScroll}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="OpenSCAD source code"
            data-code-editor
            // An empty editor is otherwise a blank panel with a blinking caret and no clue
            // that it's yours to type in. The text itself is transparent so the highlighted
            // layer shows through; placeholder color is set separately, so it still shows.
            placeholder={"// Write OpenSCAD here and the model builds as you type.\n// $fn = 48;\n// cube([20, 20, 20]);"}
            className={`${typeStyle} absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-4 whitespace-pre text-transparent caret-volt-400 outline-none placeholder:text-ink-500`}
          />
          </div>
        </div>

        {/* Status sits directly under the code, where the eyes already are. */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-ink-800 bg-ink-900 px-4 py-3">
          <Status
            empty={!code.trim()}
            isRendering={isRendering}
            error={error}
            incomplete={incomplete}
            errorLine={errorLine}
            onJump={goToErrorLine}
          />
          <span className="shrink-0 font-mono text-xs text-ink-500">
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Live feedback while editing. The model only changes when the code compiles, so this line
 * is what tells you whether what you just typed actually worked.
 */
function Status({
  empty,
  isRendering,
  error,
  incomplete,
  errorLine,
  onJump,
}: {
  empty: boolean;
  isRendering: boolean;
  error: { friendly: string; detail: string } | null;
  incomplete: string | null;
  errorLine: number | null;
  onJump: () => void;
}) {
  // An empty editor has nothing to report, and the green "up to date" would be claiming a
  // model that doesn't exist.
  if (empty) {
    return <span className="text-xs font-medium text-ink-500">Nothing to build yet</span>;
  }

  // Unfinished code outranks the last error: that error came from text you have since
  // changed, so repeating it would be pointing at the wrong thing.
  if (incomplete) {
    return (
      <span className="flex items-center gap-2 text-xs font-medium text-mist-500">
        <PencilSimple size={14} weight="duotone" className="shrink-0" />
        Waiting for {incomplete}
      </span>
    );
  }

  if (isRendering) {
    return (
      <span className="flex items-center gap-2 text-xs font-medium text-mist-500">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-volt-400" />
        Building…
      </span>
    );
  }

  if (error) {
    return (
      <button
        onClick={onJump}
        title={error.detail}
        className="flex min-w-0 items-center gap-2 rounded text-left text-xs font-medium text-rose-400 transition hover:text-rose-300"
      >
        <Warning size={14} weight="duotone" className="shrink-0" />
        <span className="truncate">
          {errorLine ? `Line ${errorLine}: ` : ""}
          {firstProblem(error.detail)}
        </span>
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2 text-xs font-medium text-emerald-400">
      <CheckCircle size={14} weight="duotone" />
      Model up to date
    </span>
  );
}
