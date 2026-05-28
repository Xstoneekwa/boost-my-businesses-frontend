import Link from "next/link";

type InstagramDashboardViewNavProps = {
  active: "manage" | "radar" | "server-check";
};

const navItems = [
  { key: "manage", label: "Manage", href: "/instagram-dashboard" },
  { key: "radar", label: "Radar", href: "/instagram-dashboard/radar" },
  { key: "server-check", label: "Server Check", href: "/instagram-dashboard/server-check" },
] as const;

export default function InstagramDashboardViewNav({ active }: InstagramDashboardViewNavProps) {
  return (
    <nav aria-label="Instagram admin views" className="ig-view-nav">
      {navItems.map((item) => {
        const isActive = item.key === active;

        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={isActive ? "ig-view-nav-link ig-view-nav-link-active" : "ig-view-nav-link"}
          >
            {item.label}
          </Link>
        );
      })}
      <style>{`
        .ig-view-nav {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
          background: rgba(255,255,255,0.035);
          padding: 4px;
        }

        .ig-view-nav-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 32px;
          border: 1px solid transparent;
          border-radius: 999px;
          color: rgba(255,255,255,0.62);
          font-size: 12px;
          font-weight: 900;
          padding: 0 12px;
          text-decoration: none;
          white-space: nowrap;
        }

        .ig-view-nav-link:hover,
        .ig-view-nav-link:focus-visible {
          color: rgba(255,255,255,0.86);
          outline: none;
        }

        .ig-view-nav-link-active {
          border-color: rgba(245,158,11,0.40);
          background: rgba(245,158,11,0.14);
          color: #FBBF24;
        }
      `}</style>
    </nav>
  );
}
