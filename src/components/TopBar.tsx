"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignOut } from "@phosphor-icons/react";
import { Logo } from "./Logo";
import { clearSession } from "@/lib/studioSession";

export function TopBar({ nickname, current }: { nickname: string; current: "studio" | "gallery" }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearSession(); // don't leave a draft for whoever signs in next on this machine
    router.push("/");
    router.refresh();
  }

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-700 bg-ink-850 px-5 py-3">
      <Link href="/studio" aria-label="Scaid home">
        <Logo />
      </Link>

      <nav className="flex items-center gap-1">
        <NavLink href="/studio" active={current === "studio"}>
          Build
        </NavLink>
        <NavLink href="/gallery" active={current === "gallery"}>
          Library
        </NavLink>

        {/* Who you are isn't somewhere you can go, so it sits outside the nav's rhythm. */}
        <span aria-hidden className="mx-3 h-5 w-px bg-ink-700" />
        <span className="hidden text-sm text-mist-500 sm:inline">{nickname}</span>
        <button
          onClick={logout}
          aria-label="Sign out"
          className="rounded-lg p-2 text-mist-500 transition hover:bg-ink-700 hover:text-mist-300"
        >
          <SignOut size={18} weight="duotone" />
        </button>
      </nav>
    </header>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
        active ? "bg-ink-700 text-mist-100" : "text-mist-500 hover:text-mist-300"
      }`}
    >
      {children}
    </Link>
  );
}
