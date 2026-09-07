"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A select styled like the rest of the app.
 *
 * A native <select> paints its menu with the operating system's own chrome, which lands as a
 * bright panel over the dark UI and can't be themed. This keeps the menu in the page, and
 * implements the listbox keyboard contract a native select gives you for free: type-ahead is
 * the only thing deliberately left out, since these lists are short.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  icon,
  align = "left",
}: {
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (next: T) => void;
  label: string;
  /** Sits inside the trigger, matching the other toolbar buttons. */
  icon?: React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const selected = options.find((option) => option.value === value);

  function openMenu() {
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
  }

  useEffect(() => {
    if (!open) return;

    // Focus the list so arrow keys act on the menu rather than scrolling the page.
    listRef.current?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function onListKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(options.length - 1, index + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        close(false);
        break;
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openMenu();
          }
        }}
        className="flex items-center gap-1.5 rounded-xl border border-ink-700 px-3.5 py-2 text-sm font-semibold text-mist-300 transition hover:border-ink-600 hover:bg-ink-800 hover:text-mist-100"
      >
        {icon}
        {selected?.label ?? ""}
        <CaretDown size={12} weight="bold" />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${listboxId}-${activeIndex}`}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className={`absolute z-40 mt-1.5 max-h-72 min-w-full overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 py-1 shadow-2xl outline-none ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => choose(index)}
                onPointerEnter={() => setActiveIndex(index)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                  index === activeIndex ? "bg-volt-500 text-white" : "text-mist-300"
                }`}
              >
                <Check
                  size={13}
                  weight="bold"
                  className={isSelected ? "opacity-100" : "opacity-0"}
                  aria-hidden
                />
                {option.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
