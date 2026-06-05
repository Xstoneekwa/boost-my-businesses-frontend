import { getRadarData, type NotificationItem } from "./radar-data";
import AdminShell from "./AdminShell";

export default async function InstagramDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let radarBadge = 0;
  let serverCheckBadge = 0;
  let radarNotifications: NotificationItem[] = [];
  let serverCheckNotifications: NotificationItem[] = [];

  try {
    const radarData = await getRadarData();
    radarBadge = radarData.notificationSummary.radarBadgeCount;
    serverCheckBadge = radarData.notificationSummary.serverCheckBadgeCount;
    radarNotifications = radarData.notificationItems.radar;
    serverCheckNotifications = radarData.notificationItems.serverCheck;
  } catch {
    // Sidebar renders without badges if radar data is unavailable
  }

  return (
    <>
      {/* @keyframes referenced by the live dot in AdminSidebar */}
      <style>{`
        @keyframes iad-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: .3; }
        }
      `}</style>
      <AdminShell
        radarBadge={radarBadge}
        serverCheckBadge={serverCheckBadge}
        radarNotifications={radarNotifications}
        serverCheckNotifications={serverCheckNotifications}
      >
        {children}
      </AdminShell>
    </>
  );
}
