"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, DownloadSimple, Warning, X } from "@phosphor-icons/react";
import { StepIcon } from "./StepIcon";
import { Markdown } from "./Markdown";
import { TOKEN_CLASS } from "./CodeEditor";
import { tokenizeScad } from "@/lib/scadHighlight";
import { downloadBlob, toFileBase } from "@/lib/exportStl";
import { zipStore, type ZipEntry } from "@/lib/zip";
import {
  dataUrlToBytes,
  toHtml,
  toMarkdown,
  toPlainText,
  type SpecDocument,
} from "@/lib/specDocument";

/** How long "Copied" and "Saved" stay up before the buttons go back to offering. */
const CONFIRM_MS = 2000;

/**
 * The whole build as one document: the picture, the numbers, the reasoning and the source.
 *
 * A read-only view, deliberately — everything here is editable somewhere else in the studio,
 * and a spec you can change is a spec that stops describing what you actually built. Its two
 * jobs are getting the thing out: onto the clipboard for a doc, or onto disk as Markdown.
 */
export function SpecDocumentModal({ spec, onClose }: { spec: SpecDocument; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [saved, setSaved] = useState(false);

  const tokens = useMemo(() => tokenizeScad(spec.code), [spec.code]);
  const lineCount = useMemo(() => spec.code.trimEnd().split("\n").length, [spec.code]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Focus moves into the dialog so Escape and the scroll keys act on it rather than on the
  // studio still sitting behind it.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  /**
   * The document on the clipboard, formatted and plain at the same time.
   *
   * Both flavours go on together and the receiving app picks: a word processor takes the
   * HTML and gets headings and a table, an editor takes the plain text and gets something
   * readable rather than a page of tags.
   */
  async function copy() {
    const html = toHtml(spec);
    const text = toPlainText(spec);

    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      } else {
        // Firefox only grew multi-flavour writes recently; plain text still gets there.
        await navigator.clipboard.writeText(text);
      }
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), CONFIRM_MS);
  }

  /**
   * The document as a file.
   *
   * With a picture it's a zip, so the Markdown and the image it points at can't be separated
   * on the way to disk. Without one there's nothing to keep together, and a lone `.md` inside
   * an archive is a folder to open for no reason.
   */
  function save() {
    const base = toFileBase(spec.name);
    const imageName = `images/${base}.png`;
    const imageBytes = spec.image ? dataUrlToBytes(spec.image) : null;
    const markdown = toMarkdown(spec, imageBytes ? imageName : null);

    if (imageBytes) {
      const entries: ZipEntry[] = [
        { name: `${base}.md`, data: new TextEncoder().encode(markdown) },
        { name: imageName, data: imageBytes },
      ];
      downloadBlob(zipStore(entries), `${base}-spec.zip`);
    } else {
      downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${base}.md`);
    }

    setSaved(true);
    setTimeout(() => setSaved(false), CONFIRM_MS);
  }

  return (
    <div
      onPointerDown={(event) => {
        // Only a press that starts on the backdrop closes it — a selection dragged out of
        // the document and released here shouldn't take the document with it.
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="spec-title"
        tabIndex={-1}
        data-spec-document
        className="flex h-[80vh] w-full max-w-[1200px] flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 shadow-2xl outline-none"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-ink-700 px-6 py-3.5">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-widest text-mist-500 uppercase">
              Spec document
            </p>
            <p className="truncate text-sm font-medium text-mist-300">{spec.name}</p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={copy}
              className="flex items-center gap-1.5 rounded-xl border border-ink-700 px-3.5 py-2 text-sm font-semibold text-mist-300 transition hover:border-ink-600 hover:bg-ink-800 hover:text-mist-100"
            >
              {copied === "done" ? (
                <Check size={15} weight="bold" className="text-emerald-400" />
              ) : copied === "failed" ? (
                <Warning size={15} weight="duotone" className="text-amber-400" />
              ) : (
                <Copy size={15} weight="duotone" className="text-cyan-400" />
              )}
              {copied === "done" ? "Copied" : copied === "failed" ? "Couldn't copy" : "Copy"}
            </button>

            <button
              onClick={save}
              className="flex items-center gap-1.5 rounded-xl bg-volt-500 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-volt-600"
            >
              {saved ? <Check size={15} weight="bold" /> : <DownloadSimple size={15} weight="duotone" />}
              {saved ? "Saved" : "Markdown"}
            </button>

            <span aria-hidden className="mx-0.5 h-5 w-px bg-ink-700" />

            <button
              onClick={onClose}
              aria-label="Close the spec document"
              className="rounded-lg p-2 text-mist-500 transition hover:bg-ink-800 hover:text-mist-100"
            >
              <X size={17} weight="bold" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
          <h2 id="spec-title" className="font-display text-3xl font-bold">
            {spec.name}
          </h2>
          <p className="mt-3 max-w-[70ch] text-[15px] leading-relaxed text-mist-300">
            {spec.description}
          </p>

          {/* The maker's own words lead the document, ahead of the model and the numbers.
              Someone reading this needs to know what they were trying to make before any
              of the rest of it means anything. */}
          {spec.readme && (
            <section className="mt-7 rounded-xl border border-ink-700 bg-ink-800 p-6">
              <h3 className="text-xs font-semibold tracking-widest text-mist-500 uppercase">
                About this project
              </h3>
              <div className="mt-3.5 max-w-[70ch]">
                <Markdown source={spec.readme} />
              </div>
            </section>
          )}

          {/* The picture and the numbers belong side by side: the measurements are the
              caption the picture doesn't have. They stack on a narrow window. */}
          <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <figure className="overflow-hidden rounded-xl border border-ink-700 bg-ink-950">
              {spec.image ? (
                /* eslint-disable-next-line @next/next/no-img-element -- a client-side data: URL */
                <img
                  src={spec.image}
                  alt={`The ${spec.name} model`}
                  className="max-h-[22rem] w-full object-contain"
                />
              ) : (
                <div className="flex h-48 items-center justify-center px-6 text-center text-sm text-mist-500">
                  No picture — the model wasn&apos;t on screen when this was opened.
                </div>
              )}
            </figure>

            <section className="self-start rounded-xl border border-ink-700 bg-ink-800 p-5">
              <h3 className="text-xs font-semibold tracking-widest text-mist-500 uppercase">
                Key measurements
              </h3>

              {spec.measured ? (
                <dl className="mt-3 space-y-2.5">
                  {spec.measurements.map((item) => (
                    <div key={item.label} className="flex items-baseline justify-between gap-4">
                      <dt className="text-sm text-mist-500">{item.label}</dt>
                      <dd
                        className={`text-right font-mono text-sm ${
                          item.warn ? "text-amber-400" : "text-mist-100"
                        }`}
                      >
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm leading-relaxed text-mist-500">
                  The model hasn&apos;t built yet, so it has no measurements.
                </p>
              )}
            </section>
          </div>

          {spec.steps.length > 0 && (
            <section className="mt-9">
              <h3 className="text-xs font-semibold tracking-widest text-mist-500 uppercase">
                How it&apos;s built
              </h3>
              <ol className="mt-4 grid gap-4 md:grid-cols-2">
                {spec.steps.map((step, index) => (
                  <li key={index} className="flex gap-3">
                    <span className="mt-0.5 shrink-0">
                      <StepIcon name={step.icon} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-mist-100">
                        {/* Two columns are read in a Z, so the sequence can't be left to
                            the layout the way it can in the single-column chat panel. */}
                        <span className="mr-2 font-mono text-xs text-mist-500">{index + 1}</span>
                        {step.title}
                      </p>
                      <p className="mt-0.5 text-[15px] leading-relaxed text-mist-300">{step.why}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="mt-9">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-xs font-semibold tracking-widest text-mist-500 uppercase">
                OpenSCAD code
              </h3>
              <span className="font-mono text-xs text-ink-500">
                {lineCount} {lineCount === 1 ? "line" : "lines"}
              </span>
            </div>

            {/* Not scrollable: a spec is read end to end, and a code window inside a
                scrolling document is a second scrollbar to fight with. */}
            <pre className="mt-3 overflow-x-auto rounded-xl border border-ink-700 bg-ink-950 p-5 font-mono text-[13px] leading-[1.6] whitespace-pre">
              <code>
                {tokens.map((token, index) => (
                  <span key={index} className={TOKEN_CLASS[token.kind]}>
                    {token.text}
                  </span>
                ))}
              </code>
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
