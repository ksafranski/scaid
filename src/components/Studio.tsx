"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CaretDown,
  CaretUp,
  ChatCircleDots,
  Code,
  ImageSquare,
  Plus,
  Warning,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { ModelViewer } from "./ModelViewer";
import { TopBar } from "./TopBar";
import { CodeEditor } from "./CodeEditor";
import { StepIcon } from "./StepIcon";
import { useScadRenderer } from "@/hooks/useScadRenderer";
import { usePanelWidth } from "@/hooks/usePanelWidth";
import { clearSession, loadSession, saveSession } from "@/lib/studioSession";
import { downloadBlob, renderStl, toFileName } from "@/lib/exportStl";
import { DownloadMenu, PlateSizePicker, SizeReadout } from "./PrintControls";
import { prepareImage, ACCEPTED_IMAGE_TYPES, type PreparedImage } from "@/lib/imageAttachment";
import { normalizeText } from "@/lib/emoji";
import { nextWorkingLine } from "@/lib/workingLines";
import { describeCreation, type BuildStep, type Creation } from "@/lib/types";

interface Design {
  name: string;
  /** What the object is — stable across tweaks, and what the library shows. */
  description?: string;
  /** What changed on this turn — the conversational message. */
  summary: string;
  steps: BuildStep[];
  code: string;
}

type Message =
  | { kind: "you"; text: string; imageUrl?: string }
  | { kind: "scaid"; design: Design; describeObject?: boolean }
  | { kind: "oops"; text: string };

const IDEAS = [
  "a phone stand angled for watching video",
  "a hex keychain with a hole for a ring",
  "a desk organizer with three slots",
  "a chess pawn",
  "a plant pot with drainage holes",
];


export function Studio({
  nickname,
  openCreationId,
  initialPlateSizeMm,
}: {
  nickname: string;
  openCreationId: string | null;
  initialPlateSizeMm: number;
}) {
  const [plateSizeMm, setPlateSizeMm] = useState(initialPlateSizeMm);
  const { modelUrl, isRendering, error: renderError, size, render, reset } = useScadRenderer(plateSizeMm);
  const { width: panelWidth, handleProps } = usePanelWidth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [design, setDesign] = useState<Design | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [prompt, setPrompt] = useState("");
  const [attachment, setAttachment] = useState<PreparedImage | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [workingLine, setWorkingLine] = useState(() => nextWorkingLine());
  const [view, setView] = useState<"chat" | "code">("chat");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const restoredRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cycle the waiting message so a slow design still feels alive.
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      setWorkingLine((current) => nextWorkingLine(current));
    }, 2600);
    return () => clearInterval(timer);
  }, [working]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, working]);

  const loadDesign = useCallback(
    (next: Design) => {
      setDesign(next);
      setSaveState("idle");
      render(next.code);
    },
    [render],
  );

  // Restore work in progress. Navigating to the Library unmounts this component, so without
  // this an unsaved build would be lost the moment someone checks their library.
  useEffect(() => {
    if (openCreationId) return; // opening a saved build takes precedence

    const snapshot = loadSession();
    if (!snapshot?.design) return;

    // Restoring client-only state on mount: reading sessionStorage during render would make
    // the server and client markup disagree, so this is the right place for it.
    setMessages(snapshot.messages as Message[]);
    setDesign(snapshot.design);
    setSavedId(snapshot.savedId);
    setLastPrompt(snapshot.lastPrompt);
    setView(snapshot.view);
    setSaveState(snapshot.saved ? "saved" : "idle");

    render(snapshot.design.code);
    restoredRef.current = true;
  }, [openCreationId, render]);

  // Persist after the restore has had its turn, so an empty first render can't wipe it.
  useEffect(() => {
    if (!restoredRef.current && messages.length === 0 && !design) return;
    restoredRef.current = true;
    saveSession({
      messages,
      design,
      savedId,
      lastPrompt,
      view,
      saved: saveState === "saved",
    });
  }, [messages, design, savedId, lastPrompt, view, saveState]);

  // Opening something from the library drops it straight into the studio.
  useEffect(() => {
    if (!openCreationId) return;
    let cancelled = false;

    (async () => {
      const response = await fetch(`/api/creations/${openCreationId}`);
      if (!response.ok || cancelled) return;
      const { creation }: { creation: Creation } = await response.json();
      if (cancelled) return;

      setSavedId(creation.id);
      setLastPrompt(creation.prompt);
      setMessages([
        { kind: "you", text: creation.prompt || "(opened from your library)" },
        { kind: "scaid", design: creation, describeObject: true },
      ]);
      loadDesign(creation);
      setSaveState("saved");
    })();

    return () => {
      cancelled = true;
    };
  }, [openCreationId, loadDesign]);

  async function submitPrompt(text: string, image: PreparedImage | null = attachment) {
    // A picture on its own is a complete request; fill in the words they didn't need to type.
    const trimmed = text.trim() || (image ? "Build this from my picture." : "");
    if (!trimmed || working) return;

    setMessages((prev) => [...prev, { kind: "you", text: trimmed, imageUrl: image?.previewUrl }]);
    setPrompt("");
    setAttachment(null);
    setAttachError(null);
    setWorking(true);
    setWorkingLine(nextWorkingLine());

    // Give the model the gist of the conversation, not every word of it.
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const message of messages) {
      if (message.kind === "you") history.push({ role: "user", content: message.text });
      else if (message.kind === "scaid") history.push({ role: "assistant", content: message.design.summary });
    }

    try {
      const response = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          currentCode: design?.code,
          history,
          image: image ? { mediaType: image.mediaType, data: image.data } : undefined,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setMessages((prev) => [...prev, { kind: "oops", text: data.error ?? "Something went wrong." }]);
        return;
      }

      setLastPrompt(trimmed);
      setMessages((prev) => [...prev, { kind: "scaid", design: data.design }]);
      loadDesign(data.design);
    } catch {
      setMessages((prev) => [...prev, { kind: "oops", text: "Couldn't reach the server. Is it still running?" }]);
    } finally {
      setWorking(false);
    }
  }

  // Typing shouldn't fire a render per keystroke; wait for a pause, then try to build.
  // The renderer keeps the last good model on screen when the code doesn't compile, so the
  // viewport only ever changes on valid code.
  const editTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function editCode(next: string) {
    setDesign((prev) => (prev ? { ...prev, code: next } : prev));
    setSaveState("idle");

    if (editTimerRef.current) clearTimeout(editTimerRef.current);
    editTimerRef.current = setTimeout(() => render(next), 500);
  }

  useEffect(() => () => {
    if (editTimerRef.current) clearTimeout(editTimerRef.current);
  }, []);

  const [exporting, setExporting] = useState(false);
  const [confirmingNew, setConfirmingNew] = useState(false);

  const hasUnsavedWork = Boolean(design) && saveState !== "saved";

  function startNew() {
    clearSession();
    reset(); // the viewport must clear too, not just the conversation
    setMessages([]);
    setDesign(null);
    setSavedId(null);
    setLastPrompt("");
    setPrompt("");
    setAttachment(null);
    setAttachError(null);
    setSaveState("idle");
    setView("chat");
    setConfirmingNew(false);
    restoredRef.current = true; // the cleared session is now the state worth persisting
  }

  function changePlateSize(next: number) {
    setPlateSizeMm(next);
    // Fire-and-forget: the preview updates immediately either way, and a failed save just
    // means the size isn't remembered next time.
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plateSizeMm: next }),
    }).catch(() => {});
  }

  function downloadScad() {
    if (!design) return;
    downloadBlob(
      new Blob([design.code], { type: "text/plain;charset=utf-8" }),
      toFileName(design.name, "scad"),
    );
  }

  async function downloadStl() {
    if (!design || exporting) return;
    setExporting(true);
    try {
      const stl = await renderStl(design.code);
      downloadBlob(
        new Blob([stl as BlobPart], { type: "model/stl" }),
        toFileName(design.name, "stl"),
      );
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          kind: "oops",
          text:
            error instanceof Error && error.message
              ? `Couldn't export the STL: ${error.message}`
              : "Couldn't export the STL. Check the model builds, then try again.",
        },
      ]);
    } finally {
      setExporting(false);
    }
  }

  async function attachFile(file: File | undefined) {
    if (!file) return;
    setAttachError(null);

    const result = await prepareImage(file);
    if (result.ok) setAttachment(result.image);
    else setAttachError(result.error);
  }

  async function save() {
    if (!design) return;
    setSaveState("saving");

    let response = await fetch("/api/creations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: savedId, prompt: lastPrompt, ...design }),
    });

    // The build we were updating has been deleted (here, or in another tab). Save it as a
    // new one rather than telling someone their work can't be saved.
    if (response.status === 404 && savedId) {
      setSavedId(null);
      response = await fetch("/api/creations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: lastPrompt, ...design }),
      });
    }

    if (!response.ok) {
      setSaveState("idle");
      setMessages((prev) => [...prev, { kind: "oops", text: "Couldn't save that. Try again." }]);
      return;
    }

    // Deliberately no router.refresh() here: it remounts this page and would wipe the
    // conversation in progress. /gallery is dynamic and refetches on visit.
    const { creation }: { creation: Creation } = await response.json();
    setSavedId(creation.id);
    setSaveState("saved");
  }

  return (
    <div className="flex h-screen flex-col">
      <TopBar nickname={nickname} current="studio" />

      {/* One toolbar for the workspace: what's on the left, and what you can do with it. */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-ink-700 bg-ink-850 px-4 py-2.5">
        <div className="flex gap-1 rounded-xl bg-ink-900 p-1">
          <ViewButton active={view === "chat"} onClick={() => setView("chat")} Glyph={ChatCircleDots}>
            Chat
          </ViewButton>
          <ViewButton active={view === "code"} onClick={() => setView("code")} Glyph={Code} disabled={!design}>
            Code
          </ViewButton>
        </div>

        {(messages.length > 0 || design) &&
          (confirmingNew ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-mist-300">Start over?</span>
              <button
                onClick={startNew}
                className="rounded-lg bg-volt-500 px-3 py-1.5 font-semibold text-white transition hover:bg-volt-400"
              >
                {hasUnsavedWork ? "Discard & start" : "Start new"}
              </button>
              <button
                onClick={() => setConfirmingNew(false)}
                className="rounded-lg px-2 py-1.5 font-semibold text-mist-500 transition hover:text-mist-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => (hasUnsavedWork ? setConfirmingNew(true) : startNew())}
              className="flex items-center gap-1.5 rounded-xl border border-ink-700 px-3 py-2 text-sm font-semibold text-mist-300 transition hover:border-ink-600 hover:bg-ink-800 hover:text-mist-100"
            >
              <Plus size={15} weight="bold" />
              New
            </button>
          ))}

        <div className="ml-auto flex items-center gap-3">
          {size && (
            <>
              <SizeReadout size={size} plateSizeMm={plateSizeMm} />
              <span aria-hidden className="h-5 w-px bg-ink-700" />
            </>
          )}
          <PlateSizePicker plateSizeMm={plateSizeMm} onChange={changePlateSize} />

          {design && (
            <>
              <DownloadMenu onDownloadScad={downloadScad} onDownloadStl={downloadStl} busy={exporting} />
              <button
                onClick={save}
                disabled={saveState !== "idle"}
                className="rounded-xl border border-ink-700 px-4 py-2 text-sm font-semibold text-mist-300 transition hover:border-ink-600 hover:bg-ink-800 hover:text-mist-100 disabled:opacity-60"
              >
                {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Save to library"}
              </button>
            </>
          )}
        </div>
      </div>

      <main
        // The width is shared by both views and set by the drag handle, so switching
        // between chat and code never shifts the layout under you.
        style={{ "--panel-width": `${panelWidth}px` } as React.CSSProperties}
        className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[var(--panel-width)_1fr]"
      >
        {/* Left panel: conversation, or the code you can edit */}
        <section className="relative flex min-h-0 flex-col border-ink-700 bg-ink-850 lg:border-r">
          {view === "code" && design ? (
            <div className="flex min-h-0 flex-1 flex-col pt-3">
              <CodeEditor
                code={design.code}
                onChange={editCode}
                isRendering={isRendering}
                error={renderError}
              />
            </div>
          ) : (
            <>
          <div ref={scrollerRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {messages.length === 0 && <Opener onPick={submitPrompt} />}

            {messages.map((message, index) => (
              <MessageBlock key={index} message={message} />
            ))}

            {working && (
              <div className="animate-rise flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-800 px-4 py-3.5">
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-volt-400" />
                <span className="text-sm font-medium text-mist-300">{workingLine}</span>
              </div>
            )}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitPrompt(prompt);
            }}
            className="shrink-0 space-y-2.5 border-t border-ink-700 bg-ink-900 p-4"
          >
            {attachment && (
              <div className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-800 p-2 pr-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- a client-side data: URL */}
                <img src={attachment.previewUrl} alt="Attached reference" className="h-11 w-11 rounded-lg object-cover" />
                <span className="flex-1 text-sm font-medium text-mist-300">Reference attached</span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  aria-label="Remove attached picture"
                  className="rounded-lg p-1.5 text-mist-500 transition hover:bg-ink-700 hover:text-mist-100"
                >
                  <X size={16} weight="bold" />
                </button>
              </div>
            )}

            {attachError && (
              <p role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
                {attachError}
              </p>
            )}

            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitPrompt(prompt);
                }
              }}
              rows={2}
              placeholder={design ? "What should change?" : "What do you want to build?"}
              className="min-h-[3.25rem] w-full resize-none rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-mist-100 transition placeholder:text-ink-500 focus:border-volt-500 focus:outline-none"
            />

            <div className="grid grid-cols-2 gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(",")}
                className="sr-only"
                onChange={(event) => {
                  attachFile(event.target.files?.[0]);
                  event.target.value = ""; // let them re-pick the same file after removing it
                }}
              />
              <button
                type="submit"
                disabled={working || (!prompt.trim() && !attachment)}
                className="rounded-xl bg-volt-500 px-4 py-3 font-semibold whitespace-nowrap text-white transition hover:bg-volt-400 disabled:opacity-40"
              >
                Build
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-xl border border-ink-700 px-4 py-3 font-semibold whitespace-nowrap text-mist-300 transition hover:border-ink-600 hover:bg-ink-800 hover:text-mist-100"
              >
                <ImageSquare size={18} weight="duotone" />
                Add a picture
              </button>
            </div>
          </form>
            </>
          )}

          <div
            {...handleProps}
            className="absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize transition-colors hover:bg-volt-500/40 focus-visible:bg-volt-500/60 lg:block"
          />
        </section>

        {/* Preview */}
        <section className="relative flex min-h-0 flex-col bg-ink-900">
          <ModelViewer src={modelUrl} spinning={isRendering} />

          {isRendering && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-xl border border-ink-700 bg-ink-850/90 px-5 py-3 text-sm font-medium text-mist-300 backdrop-blur">
                Building the model…
              </div>
            </div>
          )}

          {/* While editing, the inline status in the toolbar carries the error instead — a
              banner over the model would cover the thing you're trying to fix. */}
          {renderError && view === "chat" && (
            <RenderProblem
              error={renderError}
              onFix={() => submitPrompt("That didn't build. Please fix it.")}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function Opener({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="animate-rise">
      <h1 className="font-display text-2xl font-bold">What do you want to build?</h1>
      <p className="mt-2 leading-relaxed text-mist-300">
        Describe it in your own words. You&apos;ll get a model you can spin around, plus a
        breakdown of how it was put together.
      </p>

      <p className="mt-7 text-xs font-semibold tracking-widest text-mist-500 uppercase">Try one</p>
      <div className="mt-2.5 space-y-1.5">
        {IDEAS.map((idea) => (
          <button
            key={idea}
            onClick={() => onPick(idea)}
            className="block w-full rounded-xl border border-ink-700 bg-ink-800 px-4 py-3 text-left text-[15px] text-mist-300 transition hover:border-volt-500/50 hover:bg-ink-700 hover:text-mist-100"
          >
            {idea}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBlock({ message }: { message: Message }) {
  if (message.kind === "you") {
    return (
      <div className="animate-rise flex justify-end">
        <div className="max-w-[88%] rounded-xl rounded-br-sm bg-volt-500 px-4 py-2.5">
          {message.imageUrl && (
            /* eslint-disable-next-line @next/next/no-img-element -- a client-side data: URL */
            <img src={message.imageUrl} alt="Picture you sent" className="mb-2 max-h-36 rounded-lg object-contain" />
          )}
          <p className="font-medium text-white">{message.text}</p>
        </div>
      </div>
    );
  }

  if (message.kind === "oops") {
    return (
      <div className="animate-rise flex items-start gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3">
        <Warning size={18} weight="duotone" className="mt-0.5 shrink-0 text-rose-400" />
        <p className="text-sm text-rose-300">{message.text}</p>
      </div>
    );
  }

  const { design } = message;
  // In the flow of a conversation the useful line is what just changed; opened cold from the
  // library, it's what the thing actually is.
  const body = message.describeObject ? describeCreation(design) : design.summary;

  return (
    <div className="animate-rise rounded-xl border border-ink-700 bg-ink-800 p-5">
      <h2 className="font-display text-xl font-bold">{normalizeText(design.name)}</h2>
      <p className="mt-2 leading-relaxed text-mist-300">{normalizeText(body)}</p>

      <p className="mt-6 text-xs font-semibold tracking-widest text-mist-500 uppercase">How it&apos;s built</p>
      <ol className="mt-3 space-y-3.5">
        {design.steps.map((step, index) => (
          <li key={index} className="flex gap-3">
            <span className="mt-0.5 shrink-0">
              <StepIcon name={step.icon} />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-mist-100">{normalizeText(step.title)}</p>
              <p className="mt-0.5 text-[15px] leading-relaxed text-mist-300">{normalizeText(step.why)}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RenderProblem({
  error,
  onFix,
}: {
  error: { friendly: string; detail: string };
  onFix: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="absolute inset-x-5 top-5 rounded-xl border border-rose-500/30 bg-ink-850 p-5 shadow-2xl">
      <div className="flex items-start gap-2.5">
        <Warning size={20} weight="duotone" className="mt-0.5 shrink-0 text-rose-400" />
        <div>
          <p className="font-display font-bold">The model didn&apos;t build</p>
          <p className="mt-1 text-sm text-mist-300">{error.friendly}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={onFix}
          className="rounded-lg bg-volt-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-volt-400"
        >
          Ask Scaid to fix it
        </button>
        <button
          onClick={() => setShowDetail((value) => !value)}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-mist-500 transition hover:text-mist-300"
        >
          {showDetail ? <CaretUp size={14} weight="bold" /> : <CaretDown size={14} weight="bold" />}
          Details
        </button>
      </div>

      {showDetail && (
        <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-ink-700 bg-ink-950 p-3.5 font-mono text-xs leading-relaxed text-mist-300">
          {error.detail}
        </pre>
      )}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  disabled,
  Glyph,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  Glyph: Icon;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition disabled:opacity-40 ${
        active ? "bg-ink-700 text-mist-100" : "text-mist-500 hover:text-mist-300"
      }`}
    >
      <Glyph size={16} weight="duotone" />
      {children}
    </button>
  );
}

