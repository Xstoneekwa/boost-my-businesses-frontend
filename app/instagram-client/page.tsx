import { redirect } from "next/navigation";
import { requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import ClientDashboard from "./ClientDashboard";

export const dynamic = "force-dynamic";

export default async function InstagramClientPage() {
  const userContext = await requireInstagramDashboardAccess();

  if (userContext.role === "superadmin") {
    redirect("/instagram-dashboard");
  }

  return (
    <ClientDashboard
      userId={userContext.userId}
      tenantId={userContext.tenantId}
    />
  );
}
