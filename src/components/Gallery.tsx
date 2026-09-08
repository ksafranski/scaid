"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cube, Trash } from "@phosphor-icons/react";
import { TopBar } from "./TopBar";
import { normalizeText } from "@/lib/emoji";
import { describeCreation, type Creation } from "@/lib/types";
import { forgetIfSaved } from "@/lib/studioSession";

export function Gallery({ nickname, creations }: { nickname: string; creations: Creation[] }) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function remove(id: string) {
    await fetch(`/api/creations/${id}`, { method: "DELETE" });
    // If this is what the studio still has open, drop it — otherwise going back to Build
    // reopens a build that no longer exists and refuses to save.
    forgetIfSaved(id);
    setConfirmingId(null);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar nickname={nickname} current="gallery" />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <h1 className="font-display text-3xl font-bold">Library</h1>
        <p className="mt-1 text-mist-500">
          {creations.length === 0
            ? "Nothing saved yet."
            : `${creations.length} build${creations.length === 1 ? "" : "s"}.`}
        </p>

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
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creations.map((creation) => (
              <li
                key={creation.id}
                className="flex flex-col rounded-2xl border border-ink-700 bg-ink-850 p-5 transition hover:border-ink-600"
              >
                <h2 className="font-display font-bold">{normalizeText(creation.name)}</h2>
                <p className="mt-2 line-clamp-4 flex-1 text-sm leading-relaxed text-mist-300">
                  {normalizeText(describeCreation(creation))}
                </p>

                <p className="mt-4 text-xs text-mist-500">
                  {new Date(creation.updatedAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>

                <div className="mt-4 flex items-center gap-2">
                  <Link
                    href={`/studio?id=${creation.id}`}
                    className="flex-1 rounded-xl bg-volt-500 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-volt-600"
                  >
                    Open
                  </Link>

                  {confirmingId === creation.id ? (
                    <>
                      <button
                        onClick={() => remove(creation.id)}
                        className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmingId(null)}
                        className="rounded-xl px-3 py-2.5 text-sm font-semibold text-mist-500 transition hover:text-mist-300"
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmingId(creation.id)}
                      aria-label={`Delete ${normalizeText(creation.name)}`}
                      className="rounded-xl p-2.5 text-mist-500 transition hover:bg-rose-500/10 hover:text-rose-400"
                    >
                      <Trash size={18} weight="duotone" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
