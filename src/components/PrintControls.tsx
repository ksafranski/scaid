"use client";

import { useEffect, useRef, useState } from "react";
import {
  Blueprint,
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
import type { ModelSize } from "@/hooks/useScadRenderer";

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
 * The model's own outside dimensions — not the plate's.
 *
 * Labelled explicitly because it sits next to the plate picker, where bare numbers read as
 * though they describe the printer bed and look broken when they don't change with it.
 */
export function SizeReadout({ size, plateSizeMm }: { size: ModelSize; plateSizeMm: number }) {
  const overhangs = size.x > plateSizeMm || size.y > plateSizeMm;
  const round = (value: number) => (value < 10 ? value.toFixed(1) : Math.round(value));

  return (
    <span
      className={`flex items-center gap-1.5 text-xs ${overhangs ? "text-amber-400" : "text-mist-500"}`}
      title={
        overhangs
          ? `This model is wider than your ${plateSizeMm}mm plate, so it won't fit as-is.`
          : "The model's size: width × depth × height"
      }
    >
      {overhangs ? (
        <Warning size={13} weight="duotone" className="shrink-0" />
      ) : (
        <Ruler size={13} weight="duotone" className="shrink-0" />
      )}
      <span className="font-medium">Model</span>
      <span className="font-mono">
        {round(size.x)} × {round(size.y)} × {round(size.z)} mm
      </span>
    </span>
  );
}

export function DownloadMenu({
  onDownloadScad,
  onDownloadStl,
  onOpenSpec,
  busy,
}: {
  onDownloadScad: () => void;
  onDownloadStl: () => void;
  onOpenSpec: () => void;
  busy: boolean;
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
          <MenuItem
            Glyph={Blueprint}
            title="STL"
            detail="For your slicer — Cura, PrusaSlicer, Bambu Studio"
            onClick={() => {
              setOpen(false);
              onDownloadStl();
            }}
          />
          <MenuItem
            Glyph={CodeBlock}
            title="SCAD"
            detail="The source, to open in OpenSCAD"
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
            detail="The picture, the measurements and the code, written up"
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
}: {
  Glyph: Icon;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="group flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-ink-800"
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
