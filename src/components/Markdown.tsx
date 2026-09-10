"use client";

import { useMemo } from "react";
import { parseMarkdown, type Block, type InlineNode } from "@/lib/markdown";

/**
 * The readme, drawn in the studio's own type scale.
 *
 * Built from the parsed blocks rather than from an HTML string, so nothing anyone types
 * into the readme can become markup — the tags here are the only tags there are.
 */
export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);

  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-mist-300">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}

/**
 * Headings shrink as they nest, but only so far.
 *
 * A readme is a section of a longer page in both places it's shown, so even its `#` sits
 * below the surrounding headings — the levels order the readme against itself, not against
 * the page around it.
 */
const HEADING_CLASS = [
  "",
  "font-display text-xl font-bold text-mist-100",
  "font-display text-lg font-bold text-mist-100",
  "font-display text-base font-bold text-mist-100",
  "text-[15px] font-bold text-mist-100",
  "text-sm font-bold text-mist-100",
  "text-sm font-semibold text-mist-300",
];

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading": {
      const Tag = (`h${Math.min(6, block.level + 2)}`) as "h3";
      return (
        <Tag className={`${HEADING_CLASS[block.level]} pt-2 first:pt-0`}>
          <Inlines nodes={block.content} />
        </Tag>
      );
    }

    case "paragraph":
      return (
        <p>
          <Inlines nodes={block.content} />
        </p>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={`ml-5 space-y-1 ${block.ordered ? "list-decimal" : "list-disc"}`}>
          {block.items.map((item, index) => (
            <li key={index} className="pl-1">
              <Inlines nodes={item} />
            </li>
          ))}
        </Tag>
      );
    }

    case "code":
      return (
        <pre className="overflow-x-auto rounded-lg border border-ink-700 bg-ink-950 p-3.5 font-mono text-[13px] leading-[1.6] whitespace-pre text-mist-100">
          <code>{block.text}</code>
        </pre>
      );

    case "quote":
      return (
        <blockquote className="border-l-2 border-ink-600 pl-3.5 text-mist-500 italic">
          <Inlines nodes={block.content} />
        </blockquote>
      );

    case "rule":
      return <hr className="border-ink-700" />;
  }
}

function Inlines({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.href) {
          return (
            <a
              key={index}
              href={node.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-volt-300 underline underline-offset-2 hover:text-volt-400"
            >
              {node.text}
            </a>
          );
        }
        if (node.code) {
          return (
            <code
              key={index}
              className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-[13px] text-cyan-300"
            >
              {node.text}
            </code>
          );
        }
        if (node.bold) {
          return (
            <strong key={index} className="font-semibold text-mist-100">
              {node.text}
            </strong>
          );
        }
        if (node.italic) return <em key={index}>{node.text}</em>;
        return <span key={index}>{node.text}</span>;
      })}
    </>
  );
}
