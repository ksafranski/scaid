/**
 * A small Markdown reader for the project readme.
 *
 * Deliberately not a Markdown library. What's needed here is a readme someone types in a
 * side panel — headings, a couple of lists, some emphasis and the odd code snippet — shown
 * back to them as a preview and carried into the spec document. Every full implementation
 * is tens of kilobytes of parser plus an HTML sanitiser, and the spec's clipboard flavour
 * needs its own escaping regardless.
 *
 * The result is an AST rather than an HTML string, because the same readme has to come out
 * three ways: React elements in the studio and the spec modal, inline-styled HTML for the
 * clipboard, and plain text. Only the readme is ever run through this — the spec's own
 * Markdown export is assembled by hand and the readme goes into it verbatim, so nothing a
 * person writes can be silently dropped on the way to a file.
 *
 * What it knows: ATX headings, fenced code, bullet and numbered lists, blockquotes,
 * horizontal rules, paragraphs, and inline code, bold, italic and links. Emphasis doesn't
 * nest — `**a *b* c**` is bold with literal asterisks inside, which is a fair trade for a
 * scanner this size.
 */

export interface InlineNode {
  text: string;
  code?: boolean;
  bold?: boolean;
  italic?: boolean;
  /** Set on a link. Already checked to be a scheme worth following. */
  href?: string;
}

export type Block =
  | { kind: "heading"; level: number; content: InlineNode[] }
  | { kind: "paragraph"; content: InlineNode[] }
  | { kind: "list"; ordered: boolean; items: InlineNode[][] }
  | { kind: "code"; text: string }
  | { kind: "quote"; content: InlineNode[] }
  | { kind: "rule" };

// Order matters: code wins over everything inside it, and bold has to be tried before
// italic or `**a**` reads as an empty italic followed by a stray `a`.
const INLINE = new RegExp(
  [
    "(?<code>`[^`\\n]+`)",
    "(?<bold>\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__)",
    "(?<italic>\\*[^*\\n]+\\*|_[^_\\n]+_)",
    "(?<link>\\[[^\\]\\n]*\\]\\([^)\\s]+\\))",
  ].join("|"),
  "g",
);

/**
 * Whether a link is worth turning into a link.
 *
 * The readme is the person's own writing, so this isn't guarding against them — it's that
 * the spec's HTML travels onto a clipboard and into other people's documents, and a
 * `javascript:` href has no business making that trip. Anything unrecognised stays as text.
 */
function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  // Relative paths and in-page anchors are fine; a bare "scheme:" is not.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  return trimmed || null;
}

function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let lastIndex = 0;

  const pushText = (text: string) => {
    if (!text) return;
    // Merge runs of plain text so the renderers emit fewer elements.
    const previous = nodes[nodes.length - 1];
    if (previous && !previous.code && !previous.bold && !previous.italic && !previous.href) {
      previous.text += text;
    } else {
      nodes.push({ text });
    }
  };

  INLINE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE.exec(source)) !== null) {
    pushText(source.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;

    const groups = match.groups!;
    if (groups.code) {
      nodes.push({ text: groups.code.slice(1, -1), code: true });
    } else if (groups.bold) {
      nodes.push({ text: groups.bold.slice(2, -2), bold: true });
    } else if (groups.italic) {
      nodes.push({ text: groups.italic.slice(1, -1), italic: true });
    } else if (groups.link) {
      const split = groups.link.indexOf("](");
      const label = groups.link.slice(1, split);
      const href = safeHref(groups.link.slice(split + 2, -1));
      if (href) nodes.push({ text: label || href, href });
      else pushText(groups.link); // an href we won't follow stays as the words they typed
    }
  }

  pushText(source.slice(lastIndex));
  return nodes;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index++;
      continue;
    }

    if (FENCE.test(line)) {
      // The opening fence's language tag is ignored: the readme's snippets aren't
      // necessarily OpenSCAD, and this doesn't highlight anything.
      const body: string[] = [];
      index++;
      while (index < lines.length && !FENCE.test(lines[index])) body.push(lines[index++]);
      index++; // step past the closing fence, or off the end of an unclosed one
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      index++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        content: parseInline(heading[2].trim()),
      });
      index++;
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = !bullet;
      const items: InlineNode[][] = [];

      // A run of adjacent markers is one list. Switching between bullets and numbers ends
      // it, so a numbered plan under a bulleted one doesn't get folded into it.
      while (index < lines.length) {
        const next = ordered ? NUMBERED.exec(lines[index]) : BULLET.exec(lines[index]);
        if (!next) break;
        items.push(parseInline(next[1].trim()));
        index++;
      }

      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      const text: string[] = [];
      while (index < lines.length) {
        const next = QUOTE.exec(lines[index]);
        if (!next) break;
        text.push(next[1]);
        index++;
      }
      blocks.push({ kind: "quote", content: parseInline(text.join(" ").trim()) });
      continue;
    }

    // A paragraph runs to the next blank line or the next thing that starts a block, so a
    // heading written directly under a line of prose still becomes a heading.
    const text: string[] = [];
    while (index < lines.length) {
      const next = lines[index];
      if (
        !next.trim() ||
        FENCE.test(next) ||
        RULE.test(next) ||
        HEADING.test(next) ||
        BULLET.test(next) ||
        NUMBERED.test(next) ||
        QUOTE.test(next)
      ) {
        break;
      }
      text.push(next.trim());
      index++;
    }
    blocks.push({ kind: "paragraph", content: parseInline(text.join(" ")) });
  }

  return blocks;
}

/**
 * The readme's own title, used to name a draft saved before anything has been built.
 *
 * Only the opening heading or opening sentence counts. A readme that starts with a list or
 * a code fence has no title in it, and inventing one out of the first bullet reads worse in
 * the library than admitting the draft is untitled.
 */
export function readmeTitle(source: string): string | null {
  for (const line of source.split("\n")) {
    const text = line.trim();
    if (!text) continue;

    const heading = HEADING.exec(text);
    if (!heading && /^(?:```|[-*+>|]|\d+[.)])/.test(text)) return null;

    // Emphasis marks belong to the writing, not to the name it's giving the draft. The
    // leading hashes go too: a line like "#todo" isn't a heading by the parser's rules, and
    // carrying its punctuation into the library would be reading it as one anyway.
    const title = (heading ? heading[2] : text)
      .replace(/^#+\s*/, "")
      .replace(/[*_`]/g, "")
      .trim();
    return title ? title.slice(0, 80) : null;
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineToHtml(nodes: InlineNode[], mono: string): string {
  return nodes
    .map((node) => {
      const text = escapeHtml(node.text);
      if (node.href) return `<a href="${escapeHtml(node.href)}">${text}</a>`;
      if (node.code) return `<code style="${mono}">${text}</code>`;
      if (node.bold) return `<b>${text}</b>`;
      if (node.italic) return `<i>${text}</i>`;
      return text;
    })
    .join("");
}

/**
 * The readme as inline-styled HTML, for the spec document's clipboard flavour.
 *
 * `headingOffset` pushes the readme's own headings underneath the spec's, so a readme that
 * opens with `# My Project` doesn't outrank the document it's a section of. It changes how
 * the headings render, never the text — the Markdown export still carries the readme
 * exactly as it was typed.
 */
export function markdownToHtml(
  blocks: Block[],
  { font, headingOffset = 0 }: { font: string; headingOffset?: number },
): string {
  const mono = "font-family: 'Courier New', Courier, monospace; background: #f6f6f6;";
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const level = Math.min(6, block.level + headingOffset);
        const size = [0, 18, 15, 13, 12, 11, 11][level];
        parts.push(
          `<h${level} style="${font} margin: 14px 0 6px; font-size: ${size}pt;">${inlineToHtml(block.content, mono)}</h${level}>`,
        );
        break;
      }
      case "paragraph":
        parts.push(
          `<p style="${font} line-height: 1.5;">${inlineToHtml(block.content, mono)}</p>`,
        );
        break;
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const style = block.ordered ? "decimal outside" : "disc outside";
        parts.push(`<${tag} style="${font} line-height: 1.5; list-style: ${style}; padding-left: 24px;">`);
        for (const item of block.items) parts.push(`<li>${inlineToHtml(item, mono)}</li>`);
        parts.push(`</${tag}>`);
        break;
      }
      case "code":
        parts.push(
          `<pre style="font-family: 'Courier New', Courier, monospace; font-size: 9pt; line-height: 1.45; color: #111111; background: #f6f6f6; border: 1px solid #dddddd; padding: 10px; white-space: pre-wrap;">${escapeHtml(block.text)}</pre>`,
        );
        break;
      case "quote":
        parts.push(
          `<blockquote style="${font} line-height: 1.5; margin: 10px 0; padding-left: 12px; border-left: 3px solid #cccccc; color: #444444;">${inlineToHtml(block.content, mono)}</blockquote>`,
        );
        break;
      case "rule":
        parts.push('<hr style="border: 0; border-top: 1px solid #dddddd; margin: 16px 0;" />');
        break;
    }
  }

  return parts.join("\n");
}

function inlineToText(nodes: InlineNode[]): string {
  // Links keep their address: in plain text "the guide" alone loses the only useful half.
  return nodes
    .map((node) => (node.href && node.href !== node.text ? `${node.text} (${node.href})` : node.text))
    .join("");
}

/** The readme with its markers taken off, for the spec's plain-text flavour. */
export function markdownToPlainText(blocks: Block[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        lines.push(inlineToText(block.content), "");
        break;
      case "paragraph":
        lines.push(inlineToText(block.content), "");
        break;
      case "list":
        block.items.forEach((item, index) => {
          lines.push(`${block.ordered ? `${index + 1}.` : "•"} ${inlineToText(item)}`);
        });
        lines.push("");
        break;
      case "code":
        // Indented, which is how a code block reads when there's no way to draw a box.
        lines.push(...block.text.split("\n").map((line) => `    ${line}`), "");
        break;
      case "quote":
        lines.push(`> ${inlineToText(block.content)}`, "");
        break;
      case "rule":
        lines.push("---", "");
        break;
    }
  }

  return lines.join("\n").trimEnd();
}
