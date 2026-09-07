/** Friendly, specific validation messages — kids should never see "invalid input". */

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
 * Checked server-side only, so the code never reaches the browser bundle. Overridable by
 * env so it can be rotated in Vercel without a deploy.
 */
export function checkSignupCode(value: unknown): string | null {
  const expected = (process.env.SIGNUP_CODE || "scaidtester").trim().toLowerCase();
  if (typeof value !== "string" || !value.trim()) return "You'll need a beta code to sign up.";
  if (value.trim().toLowerCase() !== expected) return "That beta code isn't right.";
  return null;
}
