import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { toCreation, type CreationDoc } from "@/lib/types";
import { Gallery } from "@/components/Gallery";

export default async function GalleryPage() {
  const user = await requireUser();
  if (!user) redirect("/");

  const db = await getDb();
  const docs = await db
    .collection<CreationDoc>("creations")
    .find({ userId: user._id })
    .sort({ updatedAt: -1 })
    .limit(200)
    .toArray();

  return <Gallery nickname={user.nickname} creations={docs.map(toCreation)} />;
}
