import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { Studio } from "@/components/Studio";

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  // Checked against the database, not just the cookie, so this matches what the API
  // routes will allow — otherwise a stale session renders a studio that can't save.
  const user = await requireUser();
  if (!user) redirect("/");

  const { id } = await searchParams;

  return (
    <Studio
      nickname={user.nickname}
      openCreationId={id ?? null}
      initialPlateSizeMm={user.settings?.plateSizeMm ?? DEFAULT_SETTINGS.plateSizeMm}
    />
  );
}
