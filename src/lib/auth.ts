import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";
import type { UserDoc } from "./types";

const SESSION_COOKIE = "scaid_session";
const SESSION_DAYS = 30;

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "Missing or too-short SESSION_SECRET. Set a random 32+ character string in .env.local " +
        "(generate one with: openssl rand -base64 32).",
    );
  }
  return new TextEncoder().encode(value);
}

export interface SessionUser {
  id: string;
  email: string;
  nickname: string;
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({ email: user.email, nickname: user.nickname })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Reads the signed session cookie. Returns null when signed out or the token is stale. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      email: String(payload.email ?? ""),
      nickname: String(payload.nickname ?? ""),
    };
  } catch {
    return null;
  }
}

/** Looks the session user up in Mongo, so deleted accounts can't keep using a valid cookie. */
export async function requireUser(): Promise<UserDoc | null> {
  const session = await getSessionUser();
  if (!session || !ObjectId.isValid(session.id)) return null;

  const db = await getDb();
  return db.collection<UserDoc>("users").findOne({ _id: new ObjectId(session.id) });
}
