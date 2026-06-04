import AdminSidebar from "./AdminSidebar";

export default function InstagramDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`
        @keyframes iad-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: .3; }
        }

        .iad-shell {
          position: fixed;
          inset: 0;
          display: grid;
          grid-template-columns: 234px 1fr;
          height: 100vh;
          overflow: hidden;
          background: #0c0d10;
          color: #f0f0ee;
          font-family: "Inter", system-ui, sans-serif;
          font-size: 13px;
          -webkit-font-smoothing: antialiased;
        }

        .iad-main {
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
      `}</style>

      <div className="iad-shell">
        <AdminSidebar />
        <div className="iad-main">
          {children}
        </div>
      </div>
    </>
  );
}
