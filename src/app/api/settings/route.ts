import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireUser } from "@/lib/auth";
import { DEFAULT_SETTINGS, normalizePlateSize, type UserDoc } from "@/lib/types";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  return NextResponse.json({ settings: { ...DEFAULT_SETTINGS, ...user.settings } });
}

export async function PUT(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const plateSizeMm = normalizePlateSize(body?.plateSizeMm);

  if (plateSizeMm === null) {
    return NextResponse.json(
      { error: "That build plate size doesn't look right. Use a value in millimeters." },
      { status: 400 },
    );
  }

  const db = await getDb();
  await db
    .collection<UserDoc>("users")
    .updateOne({ _id: user._id }, { $set: { "settings.plateSizeMm": plateSizeMm } });

  return NextResponse.json({ settings: { plateSizeMm } });
}
