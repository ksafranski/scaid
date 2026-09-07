import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/mongodb";
import { createSession } from "@/lib/auth";
import type { UserDoc } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Please fill in your email and password." }, { status: 400 });
  }

  const db = await getDb();
  const user = await db.collection<UserDoc>("users").findOne({ email });

  // Same message either way, so this can't be used to discover which emails exist.
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !ok) {
    return NextResponse.json(
      { error: "That email and password don't match. Give it another go!" },
      { status: 401 },
    );
  }

  const session = { id: user._id.toHexString(), email: user.email, nickname: user.nickname };
  await createSession(session);
  return NextResponse.json({ user: session });
}
