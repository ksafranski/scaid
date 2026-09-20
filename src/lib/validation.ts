/** Friendly, specific validation messages — kids should never see "invalid input". */

import { createHash, timingSafeEqual } from "node:crypto";

export function checkEmail(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "Please type your email address.";
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "That doesn't look like an email address yet. It should look like name@example.com";
  }
  return null;
}

export function checkPassword(value: unknown): string | null {
  if (typeof value !== "string" || !value) return "Please make up a password.";
  if (value.length < 8) return "Make your password a bit longer — at least 8 characters.";
  if (value.length > 200) return "That password is too long. Try a shorter one.";
  return null;
}

export function checkNickname(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "What should we call you?";
  const name = value.trim();
  if (name.length > 30) return "That name is a little long — try 30 characters or fewer.";
  return null;
}

/**
 * The beta signup gate.
 *
 * The code lives only in the environment. There is deliberately no fallback baked in here:
 * this file is public, and a default in it would be a published password on any deployment
 * whose owner forgot to set the variable. Missing configuration closes the gate rather than
 * opening it — refusing a signup is recoverable, and letting the world through isn't.
 *
 * Only ever called from the signup route, so the expected value stays server-side and never
 * reaches the browser bundle.
 */
export function checkSignupCode(value: unknown): string | null {
  const expected = (process.env.SIGNUP_CODE ?? "").trim().toLowerCase();

  if (!expected) {
    // Said to the logs, not to the visitor: they can't fix it and don't need to know why.
    console.error(
      "SIGNUP_CODE is not set, so every signup is being refused. Set it in the environment " +
        "(.env.local locally, project settings on your host) to open the gate.",
    );
    return "Signups aren't open at the moment.";
  }

  if (typeof value !== "string" || !value.trim()) return "You'll need a beta code to sign up.";
  return sameSecret(value.trim().toLowerCase(), expected) ? null : "That beta code isn't right.";
}

/**
 * A comparison that takes the same time whether the first character is wrong or the last.
 *
 * A plain `===` bails at the first difference, which leaks the length of the shared prefix
 * to anyone patient enough to measure it. Hashing first gives both sides a fixed width, so
 * `timingSafeEqual` — which requires equal lengths — can be used on codes of any length.
 */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
