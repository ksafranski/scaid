"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Cube, Path, Printer } from "@phosphor-icons/react";
import { Logo } from "./Logo";

const EXAMPLES = [
  { Glyph: Cube, text: "a phone stand that holds it at an angle" },
  { Glyph: Path, text: "a hex keychain with my initials cut out" },
  { Glyph: Printer, text: "a desk organizer with three slots" },
];

export function WelcomeScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isSignup ? { nickname, email, password } : { email, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      router.push("/studio");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Is it still running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-16 px-6 py-12 lg:flex-row lg:gap-24">
      <section className="max-w-lg">
        <div className="mb-8 text-xl">
          <Logo size={26} />
        </div>

        <h1 className="font-display text-5xl leading-[1.05] font-bold sm:text-6xl">
          Describe it.
          <br />
          <span className="text-volt-400">Build it in 3D.</span>
        </h1>

        <p className="mt-6 text-lg leading-relaxed text-mist-300">
          Say what you want to make. Scaid designs it, hands you a model you can spin and
          inspect, and shows you exactly how it was built — and why.
        </p>

        <ul className="mt-10 space-y-2.5">
          {EXAMPLES.map(({ Glyph, text }) => (
            <li key={text} className="flex items-center gap-3 text-mist-500">
              <Glyph size={18} weight="duotone" className="shrink-0 text-volt-400" />
              <span className="text-[15px]">{text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="w-full max-w-sm">
        <div className="rounded-2xl border border-ink-700 bg-ink-850 p-7">
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-ink-900 p-1">
            {(["signup", "login"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  mode === value
                    ? "bg-ink-700 text-mist-100"
                    : "text-mist-500 hover:text-mist-300"
                }`}
              >
                {value === "signup" ? "Create account" : "Sign in"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <Field label="Name" value={nickname} onChange={setNickname} placeholder="Alex" autoComplete="nickname" />
            )}
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              autoComplete="email"
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder={isSignup ? "at least 8 characters" : ""}
              autoComplete={isSignup ? "new-password" : "current-password"}
            />

            {error && (
              <p role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-volt-500 px-6 py-3.5 font-semibold text-white transition hover:bg-volt-400 disabled:opacity-50"
            >
              {busy ? "One moment…" : isSignup ? "Start building" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-mist-500">
          Your builds save to your account, so you can pick them up later.
        </p>
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-mist-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className="w-full rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-mist-100 transition placeholder:text-ink-500 focus:border-volt-500 focus:outline-none"
      />
    </label>
  );
}
