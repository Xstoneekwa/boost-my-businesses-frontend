import AdminShell from "./AdminShell";

export default function InstagramDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* @keyframes referenced by the live dot in AdminSidebar */}
      <style>{`
        @keyframes iad-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: .3; }
        }
      `}</style>
      <AdminShell>{children}</AdminShell>
    </>
  );
}
