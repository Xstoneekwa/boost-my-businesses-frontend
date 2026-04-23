"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { UserContext, UserRole } from "@/lib/userContext";
import RestaurantLanguageToggle, { useRestaurantLanguage } from "@/components/restaurant-language/RestaurantLanguageToggle";
import { restaurantCommonCopy } from "@/lib/restaurant-language";

const AC = "#F59E0B";

type NavItem = {
  label: string;
  href: string;
  match: string;
  roles: UserRole[];
};

const navItems: NavItem[] = [
  { label: "Overview", href: "/restaurant-analytics/overview", match: "/restaurant-analytics/overview", roles: ["superadmin", "tenant"] },
  { label: "Tenants", href: "/restaurant-analytics/tenants", match: "/restaurant-analytics/tenants", roles: ["superadmin"] },
  { label: "Locations", href: "/restaurant-analytics/locations", match: "/restaurant-analytics/locations", roles: ["superadmin", "tenant"] },
  { label: "Handoffs", href: "/restaurant-analytics/handoffs", match: "/restaurant-analytics/handoffs", roles: ["superadmin", "tenant"] },
  { label: "Incidents", href: "/restaurant-analytics/incidents", match: "/restaurant-analytics/incidents", roles: ["superadmin"] },
  { label: "Quality", href: "/restaurant-analytics/quality", match: "/restaurant-analytics/quality", roles: ["superadmin", "tenant"] },
];

export default function DashboardLayoutShell({
  children,
  userContext,
}: {
  children: ReactNode;
  userContext: UserContext;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [lang, setLang] = useRestaurantLanguage();
  const tenantCopy = restaurantCommonCopy[lang].dashboard;
  const [isSigningOut, setIsSigningOut] = useState(false);
  const modeLabel = userContext.role === "superadmin" ? "Superadmin Mode" : tenantCopy.mode;
  const visibleNavItems = navItems.filter((item) => item.roles.includes(userContext.role));

  async function handleLogout() {
    setIsSigningOut(true);
    const supabase = createSupabaseBrowserClient();

    try {
      await supabase.auth.signOut();
    } finally {
      await fetch("/api/restaurant-auth/session", { method: "DELETE" });
      router.refresh();
      router.replace("/restaurant-login");
    }
  }

  function handleDashboardLangChange(nextLang: typeof lang) {
    setLang(nextLang);
    router.refresh();
  }

  return (
    <section
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(ellipse 60% 40% at 20% 0%, rgba(245,158,11,0.12), transparent 65%), linear-gradient(180deg, #07111f 0%, #081226 100%)",
        color: "#f0f0ef",
        fontFamily: "'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px minmax(0, 1fr)",
          minHeight: "100vh",
        }}
      >
        <aside
          style={{
            borderRight: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(7,17,31,0.78)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            padding: "22px 18px",
            position: "sticky",
            top: 0,
            height: "100vh",
          }}
        >
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              textDecoration: "none",
              marginBottom: 28,
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 7,
                background: AC,
                color: "#160b02",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "'Syne', sans-serif",
                fontWeight: 800,
                fontSize: 15,
              }}
            >
              B
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 700 }}>
                BoostMyBusinesses
              </span>
              <span style={{ color: "rgba(255,255,255,0.38)", fontSize: 11 }}>
                {userContext.role === "tenant" ? tenantCopy.restaurantAnalytics : "Restaurant analytics"}
              </span>
            </span>
          </Link>

          <div
            style={{
              border: "1px solid rgba(245,158,11,0.22)",
              background: "rgba(245,158,11,0.09)",
              borderRadius: 16,
              padding: 14,
              marginBottom: 22,
            }}
          >
            <p
              style={{
                color: AC,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 7,
              }}
            >
              {userContext.role === "tenant" ? tenantCopy.activeProduct : "Active product"}
            </p>
            <p style={{ fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.78)" }}>
              AI Restaurant Call Assistant
            </p>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                marginTop: 12,
                border: "1px solid rgba(245,158,11,0.28)",
                background: "rgba(7,17,31,0.34)",
                color: AC,
                borderRadius: 999,
                padding: "6px 10px",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {modeLabel}
            </span>
          </div>

          <nav style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {visibleNavItems.map((item) => {
              const isActive = pathname === item.match || pathname.startsWith(`${item.match}/`);
              const label =
                userContext.role === "tenant"
                  ? item.label === "Overview"
                    ? tenantCopy.nav.overview
                    : item.label === "Locations"
                      ? tenantCopy.nav.locations
                      : item.label === "Handoffs"
                        ? tenantCopy.nav.handoffs
                        : item.label === "Quality"
                          ? tenantCopy.nav.quality
                          : item.label
                  : item.label;

              return (
                <Link
                  key={item.label}
                  href={item.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    minHeight: 38,
                    padding: "9px 12px",
                    borderRadius: 12,
                    textDecoration: "none",
                    fontSize: 13,
                    fontWeight: 600,
                    color: isActive ? "#160b02" : "rgba(255,255,255,0.58)",
                    background: isActive ? AC : "transparent",
                    border: isActive ? "1px solid rgba(245,158,11,0.55)" : "1px solid transparent",
                    transition: "background 150ms, border-color 150ms, color 150ms",
                  }}
                  onMouseEnter={(event) => {
                    if (isActive) return;
                    event.currentTarget.style.color = AC;
                    event.currentTarget.style.background = "rgba(245,158,11,0.08)";
                    event.currentTarget.style.borderColor = "rgba(245,158,11,0.18)";
                  }}
                  onMouseLeave={(event) => {
                    if (isActive) return;
                    event.currentTarget.style.color = "rgba(255,255,255,0.58)";
                    event.currentTarget.style.background = "transparent";
                    event.currentTarget.style.borderColor = "transparent";
                  }}
                >
                  {label}
                  {isActive && <span style={{ fontSize: 11 }}>{userContext.role === "tenant" ? tenantCopy.liveData.split(" ")[0] : "Live"}</span>}
                </Link>
              );
            })}
          </nav>

          <div
            style={{
              marginTop: 26,
              paddingTop: 18,
              borderTop: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <Link
              href="/agent/restaurant-call-assistant"
              style={{
                color: "rgba(255,255,255,0.54)",
                fontSize: 12.5,
                textDecoration: "none",
              }}
            >
              {userContext.role === "tenant" ? tenantCopy.servicePage : "Service page"}
            </Link>
            <Link
              href="/restaurant-login"
              style={{
                color: "rgba(255,255,255,0.54)",
                fontSize: 12.5,
                textDecoration: "none",
              }}
            >
              {userContext.role === "tenant" ? tenantCopy.clientLogin : "Client login"}
            </Link>
            {userContext.role === "tenant" && <RestaurantLanguageToggle lang={lang} onLangChange={handleDashboardLangChange} />}
            <button
              type="button"
              onClick={handleLogout}
              disabled={isSigningOut}
              style={{
                border: "1px solid rgba(245,158,11,0.22)",
                background: "rgba(245,158,11,0.08)",
                color: isSigningOut ? "rgba(251,191,36,0.45)" : "#FBBF24",
                borderRadius: 999,
                padding: "9px 12px",
                font: "inherit",
                fontSize: 12.5,
                fontWeight: 800,
                cursor: isSigningOut ? "wait" : "pointer",
                textAlign: "left",
              }}
            >
              {isSigningOut ? (userContext.role === "tenant" ? tenantCopy.signingOut : "Signing out...") : userContext.role === "tenant" ? tenantCopy.logout : "Logout"}
            </button>
            <Link
              href="/"
              style={{
                color: "rgba(255,255,255,0.54)",
                fontSize: 12.5,
                textDecoration: "none",
              }}
            >
              Back to site
            </Link>
          </div>
        </aside>

        <main style={{ minWidth: 0, padding: "28px clamp(18px, 3vw, 36px) 48px" }}>
          {children}
        </main>
      </div>
    </section>
  );
}
