import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { WelcomeScreen } from "@/components/WelcomeScreen";

export default async function HomePage() {
  // requireUser (not just the cookie) so a session for a deleted account lands here
  // rather than bouncing between this page and the studio.
  const user = await requireUser();
  if (user) redirect("/studio");
  return <WelcomeScreen />;
}
