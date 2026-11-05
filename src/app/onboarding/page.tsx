// The onboarding tracker was merged into /customers (feedback item 1). This
// route now redirects there so old links and nav never dead-end.

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function OnboardingTrackerPage() {
  const me = await currentUser();
  if (!me) redirect("/login");
  redirect("/customers");
}
