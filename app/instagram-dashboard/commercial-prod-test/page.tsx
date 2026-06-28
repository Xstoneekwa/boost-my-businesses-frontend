import { notFound } from "next/navigation";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import CommercialProdTestAdminPanel from "./CommercialProdTestAdminPanel";

export const dynamic = "force-dynamic";

export default async function CommercialProdTestAdminPage() {
  const userContext = await requireInstagramDashboardAccess();
  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  return (
    <main className="dashboard-page">
      <DashboardPageHeader
        eyebrow="Commercial"
        title="Checkout test production (Agence)"
        description="Autorisation temporaire pour un parcours simulé avec email réel — admin uniquement, non facturable."
      />
      <CommercialProdTestAdminPanel />
    </main>
  );
}
