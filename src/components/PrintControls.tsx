"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowsClockwise,
  Blueprint,
  Cube,
  CaretDown,
  CodeBlock,
  DownloadSimple,
  FileText,
  Ruler,
  SquaresFour,
  Warning,
  type Icon,
} from "@phosphor-icons/react";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { WorkingText } from "./Working";
import { MAX_PLATE_MM, MIN_PLATE_MM, PLATE_PRESETS } from "@/lib/types";
import { factRows } from "@/lib/geometry/facts";
import type { GeometryReport } from "@/lib/geometry/inspect";
import type { ModelSize, OrientationAdvice } from "@/hooks/useScadRenderer";

const CUSTOM = "custom";

const clampPlate = (value: number) => Math.min(MAX_PLATE_MM, Math.max(MIN_PLATE_MM, Math.round(value)));

export function PlateSizePicker({
  plateSizeMm,
  onChange,
}: {
  plateSizeMm: number;
  onChange: (next: number) => void;
}) {
  const isPreset = (PLATE_PRESETS as readonly number[]).includes(plateSizeMm);
  const [custom, setCustom] = useState(!isPreset);

  // The text being typed is held separately from the committed size. Without this you can't
  // type "20" on the way to "200", because the intermediate value is out of range and would
  // be rejected — leaving the field stuck.
  const [draft, setDraft] = useState(String(plateSizeMm));

  const options: ReadonlyArray<DropdownOption<string>> = [
    ...PLATE_PRESETS.map((size) => ({ value: String(size), label: `${size}mm plate` })),
    { value: CUSTOM, label: "Custom…" },
  ];

  function commit(text: string) {
    const parsed = Number(text);
    if (!text.trim() || !Number.isFinite(parsed)) return;
    onChange(clampPlate(parsed));
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {/* The picker stays put in custom mode, so choosing a preset is always one click away. */}
      <Dropdown
        label="Build plate size"
        icon={<SquaresFour size={16} weight="duotone" className="text-cyan-400" />}
        value={custom ? CUSTOM : String(plateSizeMm)}
        options={options}
        onChange={(next) => {
          if (next === CUSTOM) {
            setCustom(true);
            setDraft(String(plateSizeMm));
            return;
          }
          setCustom(false);
          onChange(Number(next));
        }}
      />

      {custom && (
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Custom build plate size in millimeters</span>
          <input
            type="number"
            inputMode="numeric"
            value={draft}
            min={MIN_PLATE_MM}
            max={MAX_PLATE_MM}
            autoFocus
            onChange={(event) => {
              setDraft(event.target.value);
              commit(event.target.value);
            }}
            onBlur={() => {
              // Snap whatever they left behind into range so the field never shows a value
              // the preview isn't actually using.
              const parsed = Number(draft);
              const next = Number.isFinite(parsed) && draft.trim() ? clampPlate(parsed) : plateSizeMm;
              setDraft(String(next));
              onChange(next);
            }}
            className="w-20 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 font-medium text-mist-100 focus:border-volt-500 focus:outline-none"
          />
          <span className="text-mist-500">mm</span>
        </label>
      )}
    </div>
  );
}

/**
 * What the model is: its size, and everything else measurable about it.
 *
 * The size stays on the toolbar because it's the number people check constantly. The rest
 * sits one click behind it rather than in a panel of its own — these are facts about the
 * model, and a panel would hide the model you're reading them about.
 *
 * Labelled "Model" explicitly because it sits next to the plate picker, where bare numbers
 * read as though they describe the printer bed and look broken when they don't change with it.
 */
export function ModelFacts({
  size,
  plateSizeMm,
  metrics,
  advice,
  onTurn,
}: {
  size: ModelSize;
  plateSizeMm: number;
  metrics: GeometryReport | null;
  /** A better way up, once one has been found and built to check. */
  advice?: OrientationAdvice | null;
  onTurn?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const overhangs = size.x > plateSizeMm || size.y > plateSizeMm;
  const rows = metrics ? factRows(metrics) : [];
  const round = (value: number) => (value < 10 ? value.toFixed(1) : Math.round(value));

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const dimensions = (
    <>
      <span className="font-medium">Model</span>
      <span className="font-mono">
        {round(size.x)} × {round(size.y)} × {round(size.z)} mm
      </span>
    </>
  );

  // Only the plate warns, and only because it's the one reading that means the thing in
  // front of you cannot be made at all. Everything else in here is a measurement.
  const tone = overhangs ? "text-amber-400" : "text-mist-500";
  const Glyph = overhangs ? Warning : Ruler;

  // Until the measurements land — one frame after the model appears — there is nothing
  // behind the click, so it stays the plain readout it has always been.
  if (!rows.length) {
    return (
      <span
        className={`flex items-center gap-1.5 text-xs ${tone}`}
        title={
          overhangs
            ? `This model is wider than your ${plateSizeMm}mm plate, so it won't fit as-is.`
            : "The model's size: width × depth × height"
        }
      >
        <Glyph size={13} weight="duotone" className="shrink-0" />
        {dimensions}
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          overhangs
            ? `This model is wider than your ${plateSizeMm}mm plate, so it won't fit as-is.`
            : "What this model measures"
        }
        className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs transition hover:bg-ink-800 hover:text-mist-300 ${tone}`}
      >
        <Glyph size={13} weight="duotone" className="shrink-0" />
        {dimensions}
        <CaretDown size={10} weight="bold" className="opacity-60" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="What this model measures"
          className="absolute left-0 z-30 mt-1.5 w-72 overflow-hidden rounded-xl border border-ink-700 bg-ink-850 p-1 shadow-2xl"
        >
          {overhangs && (
            <p className="px-3 pt-2 pb-1 text-xs text-amber-400">
              Wider than your {plateSizeMm}mm plate, so it won&apos;t fit as it stands.
            </p>
          )}
          <dl className="divide-y divide-ink-800">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline gap-3 px-3 py-2">
                <dt className="w-20 shrink-0 text-xs font-semibold text-mist-500">{row.label}</dt>
                <dd className="min-w-0 text-xs text-mist-200">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          {/* Sits under the overhang figure it's about, because it is the answer to it. */}
          {advice && onTurn && (
            <div className="mt-1 rounded-lg bg-ink-800 p-3">
              <p className="text-xs leading-relaxed text-mist-200">
                Printed <span className="font-semibold">{advice.name}</span> it needs{" "}
                {advice.overhangArea === 0 ? (
                  <span className="font-semibold text-emerald-400">no support at all</span>
                ) : (
                  <>
                    support over{" "}
                    <span className="font-semibold">{Math.round(advice.overhangArea)} mm²</span>{" "}
                    instead of {Math.round(advice.currentOverhangArea)}
                  </>
                )}
                {advice.height < advice.currentHeight - 0.5 && (
                  <>
                    , and it stands {Math.round(advice.currentHeight - advice.height)} mm shorter
                  </>
                )}
                .
              </p>
              <button
                onClick={() => {
                  setOpen(false);
                  onTurn();
                }}
                className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs font-semibold text-mist-200 transition hover:bg-ink-700 hover:text-mist-100"
              >
                <ArrowsClockwise size={14} weight="bold" />
                Turn it that way
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DownloadMenu({
  onDownloadScad,
  onDownloadStl,
  onDownload3mf,
  onOpenSpec,
  busy,
  sectioned,
}: {
  onDownloadScad: () => void;
  onDownloadStl: () => void;
  onDownload3mf: () => void;
  onOpenSpec: () => void;
  busy: boolean;
  /**
   * Whether the model is currently cut open.
   *
   * Only the write-up cares. It carries a picture of the viewport, and a picture of a
   * sliced model is not a picture of the object. The two downloads are unaffected — both
   * are rendered from the real program, never from what's on screen.
   */
  sectioned?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-xl border border-ink-700 px-3.5 py-2 text-sm font-semibold text-mist-300 transition hover:border-ink-600 hover:bg-ink-800 hover:text-mist-100 disabled:opacity-60"
      >
        <DownloadSimple size={16} weight="duotone" className="text-emerald-400" />
        {busy ? <WorkingText>Exporting…</WorkingText> : "Download"}
        <CaretDown size={12} weight="bold" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1.5 w-64 overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-2xl"
        >
          {/* 3MF first: it records units and colour, which STL has no way to carry. STL
              stays because plenty of workflows still expect one. */}
          <MenuItem
            Glyph={Cube}
            title="3MF"
            detail="A printing format that records the model in millimeters, with its colours."
            onClick={() => {
              setOpen(false);
              onDownload3mf();
            }}
          />
          <MenuItem
            Glyph={Blueprint}
            title="STL"
            detail="A mesh of plain triangles, without units or colours. Read by every tool."
            onClick={() => {
              setOpen(false);
              onDownloadStl();
            }}
          />
          <MenuItem
            Glyph={CodeBlock}
            title="SCAD"
            detail="The OpenSCAD program the model was built from."
            onClick={() => {
              setOpen(false);
              onDownloadScad();
            }}
          />
          {/* Not a file the way the other two are — it opens the write-up, which is where
              you then choose between the clipboard and a Markdown folder. */}
          <MenuItem
            Glyph={FileText}
            title="Spec document"
            detail={
              sectioned
                ? "Close the cut first — the write-up takes a picture of the model."
                : "The picture, the measurements, the reasoning and the code, on one page."
            }
            disabled={sectioned}
            onClick={() => {
              setOpen(false);
              onOpenSpec();
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  Glyph,
  title,
  detail,
  onClick,
  disabled,
}: {
  Glyph: Icon;
  title: string;
  detail: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-ink-800 disabled:opacity-45 disabled:hover:bg-transparent"
    >
      <Glyph
        size={20}
        weight="duotone"
        className="mt-0.5 shrink-0 text-mist-500 transition-colors group-hover:text-volt-400"
      />
      <span className="min-w-0">
        <span className="block font-semibold text-mist-100">{title}</span>
        <span className="mt-0.5 block text-xs text-mist-500">{detail}</span>
      </span>
    </button>
  );
}
