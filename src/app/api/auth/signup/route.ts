import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { MongoServerError } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { createSession } from "@/lib/auth";
import { checkEmail, checkNickname, checkPassword, checkSignupCode } from "@/lib/validation";
import type { UserDoc } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { email, password, nickname, signupCode } = body ?? {};

  // Code first: no point telling someone their password is short if they can't sign up at all.
  const problem =
    checkSignupCode(signupCode) ?? checkEmail(email) ?? checkNickname(nickname) ?? checkPassword(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const db = await getDb();
  const now = new Date();

  try {
    const result = await db.collection<Omit<UserDoc, "_id">>("users").insertOne({
      email: String(email).trim().toLowerCase(),
      passwordHash: await bcrypt.hash(String(password), 12),
      nickname: String(nickname).trim(),
      createdAt: now,
    });

    const user = {
      id: result.insertedId.toHexString(),
      email: String(email).trim().toLowerCase(),
      nickname: String(nickname).trim(),
    };
    await createSession(user);
    return NextResponse.json({ user });
  } catch (error) {
    // Unique index on email — someone already signed up with this address.
    if (error instanceof MongoServerError && error.code === 11000) {
      return NextResponse.json(
        { error: "There's already an account with that email. Try logging in instead!" },
        { status: 409 },
      );
    }
    throw error;
  }
}
