"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Cube,
  MagnifyingGlass,
  PencilSimple,
  Rows,
  SquaresFour,
  Trash,
  type Icon,
} from "@phosphor-icons/react";
import { TopBar } from "./TopBar";
import { useLibraryView } from "@/hooks/useLibraryView";
import { normalizeText } from "@/lib/emoji";
import { describeCreation, type Creation } from "@/lib/types";
import { forgetIfSaved } from "@/lib/studioSession";

export function Gallery({ nickname, creations }: { nickname: string; creations: Creation[] }) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useLibraryView();

  /**
   * Everything a build is called or was asked for is worth matching.
   *
   * Filtered here rather than on the server: the library is capped at 200 records, they're
   * already loaded, and a round trip per keystroke would be slower than the typing.
   */
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return creations;

    return creations.filter((creation) =>
      [creation.name, describeCreation(creation), creation.prompt]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [creations, query]);

  async function remove(id: string) {
    await fetch(`/api/creations/${id}`, { method: "DELETE" });
    // If this is what the studio still has open, drop it — otherwise going back to Build
    // reopens a build that no longer exists and refuses to save.
    forgetIfSaved(id);
    setConfirmingId(null);
    router.refresh();
  }

  async function rename(id: string, name: string, description: string) {
    const response = await fetch(`/api/creations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (!response.ok) return;

    setEditingId(null);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar nickname={nickname} current="gallery" />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold">Library</h1>
            <p className="mt-1 text-mist-500">
              {creations.length === 0
                ? "Nothing saved yet."
                : query.trim()
                  ? `${matches.length} of ${creations.length} build${creations.length === 1 ? "" : "s"}.`
                  : `${creations.length} build${creations.length === 1 ? "" : "s"}.`}
            </p>
          </div>

          {creations.length > 0 && (
            <div className="flex items-center gap-3">
              <label className="relative">
                <span className="sr-only">Search your library</span>
                <MagnifyingGlass
                  size={16}
                  weight="bold"
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-mist-500"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                  className="w-52 rounded-xl border border-ink-700 bg-ink-850 py-2 pr-3 pl-9 text-sm text-mist-100 transition placeholder:text-ink-500 focus:border-volt-500 focus:outline-none"
                />
              </label>

              <div className="flex gap-1 rounded-xl bg-ink-850 p-1">
                <ViewButton active={view === "cards"} onClick={() => setView("cards")} Glyph={SquaresFour} label="Card view" />
                <ViewButton active={view === "list"} onClick={() => setView("list")} Glyph={Rows} label="List view" />
              </div>
            </div>
          )}
        </div>

        {creations.length === 0 ? (
          <div className="mt-10 flex flex-col items-center rounded-2xl border border-ink-700 bg-ink-850 p-14 text-center">
            <Cube size={48} weight="duotone" className="text-ink-600" />
            <p className="font-display mt-5 text-lg font-semibold text-mist-300">Your library is empty</p>
            <Link
              href="/studio"
              className="mt-6 rounded-xl bg-volt-500 px-5 py-3 font-semibold text-white transition hover:bg-volt-600"
            >
              Build something
            </Link>
          </div>
        ) : matches.length === 0 ? (
          <div className="mt-10 flex flex-col items-center rounded-2xl border border-ink-700 bg-ink-850 p-14 text-center">
            <MagnifyingGlass size={40} weight="duotone" className="text-ink-600" />
            <p className="font-display mt-5 text-lg font-semibold text-mist-300">
              Nothing matches &ldquo;{query.trim()}&rdquo;
            </p>
            <button
              onClick={() => setQuery("")}
              className="mt-5 rounded-xl border border-ink-700 px-4 py-2 text-sm font-semibold text-mist-300 transition hover:border-ink-600 hover:text-mist-100"
            >
              Clear the search
            </button>
          </div>
        ) : (
          <ul className={view === "cards" ? "mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "mt-8 space-y-2"}>
            {matches.map((creation) => (
              <li
                key={creation.id}
                className={
                  view === "cards"
                    ? "flex flex-col rounded-2xl border border-ink-700 bg-ink-850 p-5 transition hover:border-ink-600"
                    : "rounded-xl border border-ink-700 bg-ink-850 px-5 py-3.5 transition hover:border-ink-600"
                }
              >
                {editingId === creation.id ? (
                  <RenameForm
                    creation={creation}
                    onCancel={() => setEditingId(null)}
                    onSave={(name, description) => rename(creation.id, name, description)}
                  />
                ) : view === "cards" ? (
                  <>
                    <h2 className="font-display font-bold">{normalizeText(creation.name)}</h2>
                    <p className="mt-2 line-clamp-4 flex-1 text-sm leading-relaxed text-mist-300">
                      {normalizeText(describeCreation(creation))}
                    </p>
                    <p className="mt-4 text-xs text-mist-500">{savedOn(creation)}</p>

                    <div className="mt-4 flex items-center gap-2">
                      <Link
                        href={`/studio?id=${creation.id}`}
                        className="flex-1 rounded-xl bg-volt-500 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-volt-600"
                      >
                        Open
                      </Link>
                      <Actions
                        creation={creation}
                        confirming={confirmingId === creation.id}
                        onEdit={() => setEditingId(creation.id)}
                        onAskDelete={() => setConfirmingId(creation.id)}
                        onCancelDelete={() => setConfirmingId(null)}
                        onDelete={() => remove(creation.id)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-display font-bold">{normalizeText(creation.name)}</h2>
                      <p className="truncate text-sm text-mist-300">
                        {normalizeText(describeCreation(creation))}
                      </p>
                    </div>

                    <p className="hidden shrink-0 text-xs text-mist-500 sm:block">{savedOn(creation)}</p>

                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/studio?id=${creation.id}`}
                        className="rounded-xl bg-volt-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-volt-600"
                      >
                        Open
                      </Link>
                      <Actions
                        creation={creation}
                        confirming={confirmingId === creation.id}
                        onEdit={() => setEditingId(creation.id)}
                        onAskDelete={() => setConfirmingId(creation.id)}
                        onCancelDelete={() => setConfirmingId(null)}
                        onDelete={() => remove(creation.id)}
                      />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function savedOn(creation: Creation): string {
  return new Date(creation.updatedAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The name and description in your own words.
 *
 * Saving marks the record as titled, which is what keeps the next build in the studio from
 * overwriting it — the agent rewrites both of these on every turn otherwise.
 */
function RenameForm({
  creation,
  onSave,
  onCancel,
}: {
  creation: Creation;
  onSave: (name: string, description: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(normalizeText(creation.name));
  const [description, setDescription] = useState(normalizeText(describeCreation(creation)));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onSave(name, description);
      }}
      className="space-y-2"
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
        maxLength={80}
        placeholder="Name"
        className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-display font-bold text-mist-100 placeholder:text-ink-500 focus:border-volt-500 focus:outline-none"
      />
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
        maxLength={500}
        rows={3}
        placeholder="What is it?"
        className="w-full resize-none rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-mist-100 placeholder:text-ink-500 focus:border-volt-500 focus:outline-none"
      />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-xl bg-volt-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-volt-600 disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl px-3 py-2 text-sm font-semibold text-mist-500 transition hover:text-mist-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Actions({
  creation,
  confirming,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  creation: Creation;
  confirming: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  if (confirming) {
    return (
      <>
        <button
          onClick={onDelete}
          className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500"
        >
          Delete
        </button>
        <button
          onClick={onCancelDelete}
          className="rounded-xl px-2 py-2 text-sm font-semibold text-mist-500 transition hover:text-mist-300"
        >
          Keep
        </button>
      </>
    );
  }

  const label = normalizeText(creation.name);
  return (
    <>
      <button
        onClick={onEdit}
        aria-label={`Rename ${label}`}
        title="Rename"
        className="rounded-xl p-2.5 text-mist-500 transition hover:bg-ink-800 hover:text-mist-100"
      >
        <PencilSimple size={17} weight="duotone" />
      </button>
      <button
        onClick={onAskDelete}
        aria-label={`Delete ${label}`}
        title="Delete"
        className="rounded-xl p-2.5 text-mist-500 transition hover:bg-rose-500/10 hover:text-rose-400"
      >
        <Trash size={17} weight="duotone" />
      </button>
    </>
  );
}

function ViewButton({
  active,
  onClick,
  Glyph,
  label,
}: {
  active: boolean;
  onClick: () => void;
  Glyph: Icon;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`rounded-lg p-2 transition ${
        active ? "bg-ink-700 text-mist-100" : "text-mist-500 hover:text-mist-300"
      }`}
    >
      <Glyph size={17} weight="duotone" />
    </button>
  );
}
