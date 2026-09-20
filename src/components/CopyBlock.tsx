"use client";

import { useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";

/** A block of shell or slash commands with the one button anybody actually wants beside it. */
export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the text is selectable either way.
    }
  }

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-ink-700 bg-ink-950 p-3 pr-12 font-mono text-xs leading-relaxed text-mist-100">
        {text}
      </pre>
      <button
        onClick={copy}
        aria-label="Copy"
        className="absolute top-2 right-2 flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs font-semibold text-mist-300 transition hover:border-ink-600 hover:text-mist-100"
      >
        {copied ? <Check size={13} weight="bold" /> : <Copy size={13} weight="duotone" />}
      </button>
    </div>
  );
}
