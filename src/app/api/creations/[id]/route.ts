import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireUser } from "@/lib/auth";
import { toCreation, type CreationDoc } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "We couldn't find that creation." }, { status: 404 });
  }

  const db = await getDb();
  const doc = await db
    .collection<CreationDoc>("creations")
    .findOne({ _id: new ObjectId(id), userId: user._id });

  if (!doc) return NextResponse.json({ error: "We couldn't find that creation." }, { status: 404 });
  return NextResponse.json({ creation: toCreation(doc) });
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "We couldn't find that creation." }, { status: 404 });
  }

  const db = await getDb();
  const result = await db
    .collection<CreationDoc>("creations")
    .deleteOne({ _id: new ObjectId(id), userId: user._id });

  if (!result.deletedCount) {
    return NextResponse.json({ error: "We couldn't find that creation." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
