import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireUser } from "@/lib/auth";
import { toCreation, type BuildStep, type CreationDoc } from "@/lib/types";
import { MAX_VERSIONS, type Version } from "@/lib/versions";
import { getPattern } from "@/lib/scadPatterns";

/**
 * The history, checked before it is stored.
 *
 * Everything here arrives from a browser, so none of it is trusted: the shape, the count and
 * the size of each program are all re-imposed rather than assumed. The measurements are kept
 * as they came, because they are only ever read back to describe a difference — nothing is
 * decided on them, and a wrong one costs a sentence rather than a model.
 */
function sanitizeVersions(value: unknown): Version[] {
  if (!Array.isArray(value)) return [];

  const clean = value
    .filter(
      (entry): entry is Version =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as Version).code === "string" &&
        (entry as Version).code.length <= 60_000 &&
        typeof (entry as Version).label === "string" &&
        typeof (entry as Version).at === "number" &&
        Number.isFinite((entry as Version).at),
    )
    .map((entry) => ({
      code: entry.code,
      label: entry.label.slice(0, 300),
      measured: entry.measured ?? null,
      at: entry.at,
    }));

  return clean.slice(-MAX_VERSIONS);
}

/** List everything the signed-in user has saved, newest first. */
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  const db = await getDb();
  const docs = await db
    .collection<CreationDoc>("creations")
    .find({ userId: user._id })
    .sort({ updatedAt: -1 })
    .limit(200)
    .toArray();

  return NextResponse.json({ creations: docs.map(toCreation) });
}

/** Save a new creation, or overwrite one the user already owns when `id` is supplied. */
export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { id, name, prompt, code, description, summary, steps, readme, versions, patternIds } =
    body ?? {};

  // A readme on its own is a saveable record: a plan written before the model exists is
  // still work worth keeping. Only a record with neither is nothing at all.
  const hasCode = typeof code === "string" && Boolean(code.trim());
  const hasReadme = typeof readme === "string" && Boolean(readme.trim());
  if (!hasCode && !hasReadme) {
    return NextResponse.json({ error: "There's nothing to save yet." }, { status: 400 });
  }

  const db = await getDb();
  const collection = db.collection<CreationDoc>("creations");
  const now = new Date();

  const fields = {
    name: typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : "Untitled creation",
    prompt: typeof prompt === "string" ? prompt.slice(0, 2000) : "",
    code: hasCode ? (code as string) : "",
    description: typeof description === "string" ? description.slice(0, 500) : "",
    summary: typeof summary === "string" ? summary.slice(0, 2000) : "",
    steps: Array.isArray(steps) ? (steps.slice(0, 20) as BuildStep[]) : [],
    // The maker's own words, so unlike the name and description there's no agent version
    // of this to protect it from — it's saved as written every time.
    readme: typeof readme === "string" ? readme.slice(0, 20_000) : "",
    // Trimmed here as well as in the browser. The cap is what keeps a record from growing
    // without limit over a long afternoon, and a cap only the client honours isn't one.
    versions: sanitizeVersions(versions),
    // Provenance, kept because it can't be worked out again from the code. Checked against
    // the real library rather than stored as given: an id nobody recognises would come back
    // on the next turn and throw where the patterns are resolved.
    patternIds: Array.isArray(patternIds)
      ? patternIds.filter((id: unknown): id is string => typeof id === "string" && getPattern(id) !== undefined).slice(0, 12)
      : [],
    updatedAt: now,
  };

  if (typeof id === "string" && ObjectId.isValid(id)) {
    // A name the person wrote themselves outlives the agent's. Without this, the next build
    // would quietly put the generated wording back and the rename would look like a bug.
    const existing = await collection.findOne({ _id: new ObjectId(id), userId: user._id });
    const changes = existing?.titled
      ? { ...fields, name: existing.name, description: existing.description ?? "" }
      : fields;

    // Scoping the filter by userId means one person can never overwrite another's work.
    const updated = await collection.findOneAndUpdate(
      { _id: new ObjectId(id), userId: user._id },
      { $set: changes },
      { returnDocument: "after" },
    );
    if (!updated) return NextResponse.json({ error: "We couldn't find that creation." }, { status: 404 });
    return NextResponse.json({ creation: toCreation(updated) });
  }

  const doc = { ...fields, userId: user._id, createdAt: now } as Omit<CreationDoc, "_id">;
  const result = await collection.insertOne(doc as CreationDoc);
  return NextResponse.json({ creation: toCreation({ ...doc, _id: result.insertedId } as CreationDoc) });
}
