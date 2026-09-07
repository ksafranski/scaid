"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  CaretDown,
  CaretUp,
  ChatCircleDots,
  Code,
  ImageSquare,
  Plus,
  Warning,
  Wrench,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { ModelViewer } from "./ModelViewer";
import { TopBar } from "./TopBar";
import { CodeEditor } from "./CodeEditor";
import { StepIcon } from "./StepIcon";
import { AgentActivity, IDLE_ACTIVITY, type Activity } from "./AgentActivity";
import { readEvents, type AgentDesign } from "@/lib/agentEvents";
import { useScadRenderer } from "@/hooks/useScadRenderer";
import { usePanelWidth } from "@/hooks/usePanelWidth";
import { clearSession, loadSession, saveSession } from "@/lib/studioSession";
import { downloadBlob, renderStl, toFileName } from "@/lib/exportStl";
import { DownloadMenu, PlateSizePicker, SizeReadout } from "./PrintControls";
import { prepareImage, ACCEPTED_IMAGE_TYPES, type PreparedImage } from "@/lib/imageAttachment";
import { normalizeText } from "@/lib/emoji";
import { describeCreation, type BuildStep, type Creation } from "@/lib/types";
import { incompleteReason } from "@/lib/scadSyntax";

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
  /** Something the checks noticed and thought you'd want to know. Not an error. */
  | { kind: "note"; text: string }
  | { kind: "oops"; text: string };

/** How many times a failed build is repaired without being asked. */
const AUTO_REPAIR_LIMIT = 1;

/**
 * Starting points for someone with no idea in mind.
 *
 * Every one is a single recognizable object that a few basic solids can make, so the first
 * build lands fast and looks like the thing it's named after. Nothing here needs lettering:
 * OpenSCAD's text() depends on fonts the browser build doesn't ship, so a suggestion that
 * leads there would fail for reasons the person can't do anything about.
 */
const IDEAS = [
  "a chess pawn",
  "a phone stand angled for watching video",
  "a plant pot with drainage holes",
  "a hex keychain with a hole for a ring",
  "a desk organizer with three slots",
  "a die with rounded corners",
  "a coffee mug with a chunky handle",
  "a pencil cup",
  "a door wedge",
  "a tealight holder",
  "a soap dish with drainage slots",
  "a spinning top",
  "a guitar pick",
  "a napkin ring",
  "a coaster with a raised rim",
  "a small funnel",
  "a bookend",
  "a cable clip for the edge of a desk",
  "a domino",
  "a drawer knob",
  "a toothbrush holder",
  "a stacking cup",
  "a paperweight shaped like a mountain",
  "a luggage tag",
  "a tiny vase for one flower",
  "a cookie cutter shaped like a star",
  "a four-sided pyramid",
  "a heart keychain",
  "a ring stand",
  "a bowl with a wavy rim",
];

const IDEAS_SHOWN = 5;

/** Nothing to subscribe to — the value only differs between the server and the browser. */
const noStoreUpdates = () => () => {};

/** A handful of ideas at random, so the list isn't the same five every visit. */
function pickIdeas(): string[] {
  const pool = [...IDEAS];
  const picked: string[] = [];
  while (picked.length < IDEAS_SHOWN && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}


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
  const [activity, setActivity] = useState<Activity>(IDLE_ACTIVITY);
  /** What the code being edited is still missing, or null when it's ready to compile. */
  const [incomplete, setIncomplete] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "code">("chat");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const restoredRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  /** The conversation itself, measured so the view can follow it as it grows. */
  const conversationRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  /**
   * The code the agent last handed us, so a render failure can be traced back to it.
   *
   * Auto-repair only fires for code that came from the agent and hasn't been touched since —
   * an error while someone is editing their own code is theirs to fix, not ours to overwrite.
   */
  const repairRef = useRef<{ code: string; goal: string; attempts: number } | null>(null);

  /** Whether the view should keep following the bottom of the conversation. */
  const followingRef = useRef(true);

  /**
   * Follow the conversation as it grows.
   *
   * Growth is detected by measuring the conversation rather than by listing the state that
   * ought to change its height. During a build the panel gets taller several times — the
   * plan, each part, any notes — and text reflows for reasons React never sees: a line that
   * wraps, the panel being dragged wider. Watching the element catches all of them, and
   * there's no dependency list to keep in step with the UI.
   *
   * Whether to follow is decided by what *you* did, not by arithmetic on heights. The only
   * way the position moves upward is if you moved it, because every scroll here goes down
   * toward the bottom — so an upward move means you're reading something and following
   * stops. Reaching the bottom again turns it back on, which is also why it can't get stuck:
   * the scrolls it performs end at the bottom, so the "on" condition keeps re-arming itself.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    const conversation = conversationRef.current;
    if (!scroller || !conversation) return;

    const observer = new ResizeObserver(() => {
      if (!followingRef.current) return;
      // Deliberately not smooth. A build grows the panel every second or so, and chaining
      // animations that never finish before the next one starts reads as lag. Smooth
      // scrolling also stops dead in a background tab, which is exactly where a 40-second
      // build tends to end up — you'd come back to a view stranded mid-conversation.
      scroller.scrollTop = scroller.scrollHeight;
    });

    observer.observe(conversation);
    return () => observer.disconnect();
    // The scroller unmounts when the panel switches to the code editor, so the observer has
    // to be attached again on the way back.
  }, [view]);

  const lastScrollTopRef = useRef(0);

  function trackScrollDirection() {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    // Moving up is always your doing; nothing here ever scrolls that way.
    if (scroller.scrollTop < lastScrollTopRef.current - 2) followingRef.current = false;
    lastScrollTopRef.current = scroller.scrollTop;

    const fromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (fromBottom < 120) followingRef.current = true; // back at the bottom, so follow again
  }

  const loadDesign = useCallback(
    (next: Design) => {
      setDesign(next);
      setSaveState("idle");
      setIncomplete(null); // whatever was half-typed has just been replaced
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

  /**
   * Creations already loaded from the URL, so each one opens exactly once.
   *
   * Start new drops the id from the address bar without navigating, which leaves this prop
   * holding an id whose project is no longer open. Recording what has been consumed means a
   * later re-run of this effect can't quietly fetch that project back over a blank one.
   */
  const openedRef = useRef<string | null>(null);

  // Opening something from the library drops it straight into the studio.
  useEffect(() => {
    if (!openCreationId || openedRef.current === openCreationId) return;
    let cancelled = false;

    (async () => {
      const response = await fetch(`/api/creations/${openCreationId}`);
      if (!response.ok || cancelled) return;
      const { creation }: { creation: Creation } = await response.json();
      if (cancelled) return;

      // Marked here rather than up front: development mounts every effect twice, and the
      // first pass is cancelled before it can load anything. Claiming the id early would
      // make the second pass skip the work the first one never finished.
      openedRef.current = openCreationId;

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

  /**
   * Runs the agent and reports what it's doing as it does it.
   *
   * The response is a stream of events describing real work — the approach, each part as
   * it's named, the code as it's written — so the panel above the composer shows the build
   * happening rather than a spinner and a guess.
   */
  async function streamAgent(payload: Record<string, unknown>): Promise<AgentDesign | null> {
    setActivity(IDLE_ACTIVITY);

    const response = await fetch("/api/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Anything rejected before the stream opens still comes back as a normal JSON error.
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => null);
      setMessages((prev) => [...prev, { kind: "oops", text: data?.error ?? "Something went wrong." }]);
      return null;
    }

    let design: AgentDesign | null = null;
    const notes: string[] = [];

    for await (const event of readEvents(response.body)) {
      switch (event.t) {
        case "stage":
          setActivity((prev) => ({ ...prev, stage: event.stage }));
          break;
        case "plan":
          setActivity((prev) => ({ ...prev, plan: event.plan }));
          break;
        case "name":
          setActivity((prev) => ({ ...prev, name: event.name }));
          break;
        case "part":
          setActivity((prev) => ({
            ...prev,
            parts: [...prev.parts, { icon: event.icon, title: event.title }],
          }));
          break;
        case "lines":
          setActivity((prev) => ({ ...prev, lines: event.count }));
          break;
        case "note":
          notes.push(event.text);
          setActivity((prev) => ({ ...prev, notes: [...prev.notes, event.text] }));
          break;
        case "design":
          design = event.design;
          break;
        case "error":
          setMessages((prev) => [...prev, { kind: "oops", text: event.error }]);
          break;
      }
    }

    // The activity panel disappears when the build lands, so anything the checks found has
    // to move into the conversation to survive.
    if (design && notes.length) {
      setMessages((prev) => [...prev, ...notes.map((text) => ({ kind: "note" as const, text }))]);
    }

    return design;
  }

  async function submitPrompt(text: string, image: PreparedImage | null = attachment) {
    // A picture on its own is a complete request; fill in the words they didn't need to type.
    const trimmed = text.trim() || (image ? "Build this from my picture." : "");
    if (!trimmed || working) return;

    setMessages((prev) => [...prev, { kind: "you", text: trimmed, imageUrl: image?.previewUrl }]);
    setPrompt("");
    setAttachment(null);
    setAttachError(null);
    setWorking(true);

    // Give the model the gist of the conversation, not every word of it.
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const message of messages) {
      if (message.kind === "you") history.push({ role: "user", content: message.text });
      else if (message.kind === "scaid") history.push({ role: "assistant", content: message.design.summary });
    }

    try {
      const built = await streamAgent({
        prompt: trimmed,
        currentCode: design?.code,
        history,
        image: image ? { mediaType: image.mediaType, data: image.data } : undefined,
      });
      if (!built) return;

      setLastPrompt(trimmed);
      setMessages((prev) => [...prev, { kind: "scaid", design: built }]);
      // Arm the repair loop: if this code doesn't compile, it's ours to fix.
      repairRef.current = { code: built.code, goal: built.description || trimmed, attempts: 0 };
      loadDesign(built);
    } catch {
      setMessages((prev) => [...prev, { kind: "oops", text: "Couldn't reach the server. Is it still running?" }]);
    } finally {
      setWorking(false);
    }
  }

  /**
   * Sends failing code back with the compiler's own message.
   *
   * This is a different job from a design turn: the fault is known exactly, so the agent is
   * asked to change that and nothing else rather than to reconsider the whole model.
   */
  const runRepair = useCallback(
    async (detail: string) => {
      const target = repairRef.current;
      if (!target || working) return;

      repairRef.current = null; // one attempt at a time
      setWorking(true);

      try {
        const fixed = await streamAgent({
          prompt: "Fix the build error.",
          repair: { code: target.code, error: detail, goal: target.goal },
        });
        if (!fixed) return;

        // A repair changes the code, not what the thing is — so the name, description and
        // step-by-step from the original build all still stand.
        setDesign((prev) => (prev ? { ...prev, code: fixed.code } : prev));
        setSaveState("idle");
        setIncomplete(null);
        // What was wrong arrived as a note event while the fix was being written, so it's
        // already in the conversation — adding `summary` here would say it twice.
        repairRef.current = { ...target, code: fixed.code, attempts: target.attempts + 1 };
        render(fixed.code);
      } catch {
        setMessages((prev) => [
          ...prev,
          { kind: "oops", text: "Couldn't reach the server to fix that. Is it still running?" },
        ]);
      } finally {
        setWorking(false);
      }
    },
    // streamAgent is redefined every render, but it only ever touches state through setters,
    // so the captured copy can't go stale.
    [working, render],
  );

  // Code the agent wrote that doesn't compile is a bug we shipped, so fix it without being
  // asked — once. After that the manual button takes over, so a model that can't solve this
  // particular error can't burn requests in a loop.
  useEffect(() => {
    if (!renderError || isRendering || working) return;

    const target = repairRef.current;
    if (!target || target.attempts >= AUTO_REPAIR_LIMIT) return;
    // Someone has edited the code since; their error, their fix.
    if (target.code !== design?.code) return;

    runRepair(renderError.detail);
  }, [renderError, isRendering, working, design?.code, runRepair]);

  // Typing shouldn't fire a render per keystroke; wait for a pause, then try to build.
  // The renderer keeps the last good model on screen when the code doesn't compile, so the
  // viewport only ever changes on valid code.
  const editTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function editCode(next: string) {
    // Writing into an empty editor starts a build from nothing, so there's a design to hold
    // it. The agent overwrites all of this the moment it's asked to change anything.
    setDesign((prev) =>
      prev
        ? { ...prev, code: next }
        : {
            name: "Hand-built model",
            description: "Written by hand in the code editor.",
            summary: "",
            steps: [],
            code: next,
          },
    );
    setSaveState("idle");
    if (editTimerRef.current) clearTimeout(editTimerRef.current);

    // Half-typed code isn't a mistake, so it doesn't get compiled and it doesn't get an
    // error. The last model stays put and the footer says what's still open.
    const pending = incompleteReason(next);
    setIncomplete(pending);
    if (pending) return;

    editTimerRef.current = setTimeout(() => render(next), 500);
  }

  useEffect(() => () => {
    if (editTimerRef.current) clearTimeout(editTimerRef.current);
  }, []);

  const [exporting, setExporting] = useState(false);
  const [confirmingNew, setConfirmingNew] = useState(false);

  const hasUnsavedWork = Boolean(design) && saveState !== "saved";

  /**
   * A genuinely blank studio, which opens centered rather than docked to the bottom.
   *
   * Code written by hand counts as a start, even with nothing said: the suggestions would
   * read as ways to begin while actually asking for the existing model to be changed into
   * one of them.
   */
  const atStart = messages.length === 0 && !design;

  // A blank studio has exactly one thing to do, so put the caret there — on arrival and
  // again on Start new. preventScroll because the composer sits mid-panel at this point and
  // focusing it shouldn't shunt the centered layout around.
  useEffect(() => {
    if (atStart) promptRef.current?.focus({ preventScroll: true });
  }, [atStart]);

  function startNew() {
    clearSession();
    // The address bar still names the creation that was open, so a refresh would load it
    // straight back over the blank project. Rewritten in place rather than navigated: a route
    // change re-runs this page's server render, and its database read, to drop a parameter.
    const url = new URL(window.location.href);
    if (url.searchParams.has("id")) {
      url.searchParams.delete("id");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }

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
    setActivity(IDLE_ACTIVITY);
    setIncomplete(null);
    repairRef.current = null;
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
          <ViewButton active={view === "code"} onClick={() => setView("code")} Glyph={Code}>
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
          {view === "code" ? (
            <div className="flex min-h-0 flex-1 flex-col pt-3">
              <CodeEditor
                code={design?.code ?? ""}
                onChange={editCode}
                isRendering={isRendering}
                error={renderError}
                incomplete={incomplete}
              />
            </div>
          ) : (
            <>
          <div
            ref={scrollerRef}
            onScroll={trackScrollDirection}
            // The vertical padding goes while the panel is empty: it belongs to the messages,
            // and on an empty scroller it is 40px of height the counterweight can't match,
            // which would leave the opening group sitting off-center by exactly that much.
            className={`min-h-0 flex-1 overflow-y-auto px-5 ${atStart ? "py-0" : "py-5"}`}
          >
            {/* The conversation is wrapped so its height can be observed on its own — the
                scroller's own box never changes when a message is added to it. */}
            <div ref={conversationRef} className="space-y-4">
              {messages.map((message, index) => (
                <MessageBlock key={index} message={message} />
              ))}

              {working && <AgentActivity activity={activity} />}
            </div>
          </div>

          {atStart && <OpenerHeading />}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitPrompt(prompt);
            }}
            // Docked to the bottom once there's a conversation. Before that it sits in the
            // middle of the opening group, so the rule moves underneath it to divide the
            // composer from the suggestions rather than marking the bottom of the panel.
            className={`shrink-0 space-y-2.5 p-4 ${
              atStart ? "border-b border-ink-700" : "border-t border-ink-700 bg-ink-900"
            }`}
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
              ref={promptRef}
              rows={3}
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

          {atStart && <OpenerIdeas onPick={submitPrompt} />}

          {/*
            The counterweight that centers the opening screen.

            The empty scroller above and this below both take an equal share of the free
            space, which leaves the title and the composer sitting in the middle with no
            measuring involved. Sending the first prompt shrinks this back to nothing, and
            the composer slides down into its docked position on the way.
          */}
          <div
            aria-hidden
            style={{ flexGrow: atStart ? 1 : 0 }}
            className="shrink-0 basis-0 transition-[flex-grow] duration-500 ease-out motion-reduce:transition-none"
          />
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
              onFix={() => {
                // Hand the compiler's own message to the narrow repair pass when the failing
                // code is the agent's; otherwise it's edited code, so ask for a fresh design.
                if (repairRef.current?.code === design?.code) runRepair(renderError.detail);
                else submitPrompt("That didn't build. Please fix it.");
              }}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function OpenerHeading() {
  return (
    <div className="animate-rise shrink-0 px-5">
      <h1 className="font-display text-2xl font-bold">What do you want to build?</h1>
      <p className="mt-2 leading-relaxed text-mist-300">
        Describe it in your own words. You&apos;ll get a model you can spin around, plus a
        breakdown of how it was put together.
      </p>
    </div>
  );
}

/** Suggestions, sitting under the composer as a fallback for when nothing comes to mind. */
function OpenerIdeas({ onPick }: { onPick: (text: string) => void }) {
  // The server and the browser would roll different numbers, so the server-rendered markup
  // uses a fixed set and the shuffle happens once hydration has caught up. Same reason
  // usePanelWidth reaches for this: it's the supported way to render the two differently.
  const hydrated = useSyncExternalStore(
    noStoreUpdates,
    () => true,
    () => false,
  );
  const ideas = useMemo(() => (hydrated ? pickIdeas() : IDEAS.slice(0, IDEAS_SHOWN)), [hydrated]);

  return (
    <div className="animate-rise min-h-0 overflow-y-auto px-5 pt-4 pb-2">
      <p className="text-xs font-semibold tracking-widest text-mist-500 uppercase">Try one</p>
      <div className="mt-2.5 space-y-1.5">
        {ideas.map((idea) => (
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

  if (message.kind === "note") {
    return (
      // A problem that has already been dealt with is just part of the story, so it sits in
      // the same box as everything else. The wrench carries the meaning; a colored panel
      // would keep flagging it as something to worry about.
      <div className="animate-rise flex items-start gap-2.5 rounded-xl border border-ink-700 bg-ink-800 px-4 py-3">
        <Wrench size={17} weight="duotone" className="mt-0.5 shrink-0 text-amber-400" />
        <p className="text-sm leading-relaxed text-mist-300">{message.text}</p>
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

