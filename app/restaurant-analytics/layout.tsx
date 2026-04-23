import type { ReactNode } from "react";
import DashboardLayoutShell from "@/components/restaurant-analytics/DashboardLayoutShell";
import { requireDashboardUserContext } from "@/lib/restaurant-analytics/session";

export default async function RestaurantAnalyticsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const userContext = await requireDashboardUserContext();

  return (
    <DashboardLayoutShell userContext={userContext}>
      {children}
    </DashboardLayoutShell>
  );
}
