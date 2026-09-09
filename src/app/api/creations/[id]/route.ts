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

/**
 * Rename a creation, or rewrite what it says it is.
 *
 * Marks the record `titled`, which is what stops the next build in the studio from putting
 * the agent's own wording back over the top of it.
 */
export async function PATCH(request: Request, { params }: Context) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "We couldn't find that creation." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";

  if (!name) return NextResponse.json({ error: "Give it a name." }, { status: 400 });

  const db = await getDb();
  const updated = await db.collection<CreationDoc>("creations").findOneAndUpdate(
    // Scoped by userId so one person can never rename another's work.
    { _id: new ObjectId(id), userId: user._id },
    {
      // updatedAt is deliberately untouched. It means "last worked on", it's the date shown
      // on the card, and it's the sort order — renaming something shouldn't reshuffle the
      // library or claim you built it today.
      $set: {
        name: name.slice(0, 80),
        description: description.slice(0, 500),
        titled: true,
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) return NextResponse.json({ error: "We couldn't find that creation." }, { status: 404 });
  return NextResponse.json({ creation: toCreation(updated) });
}
