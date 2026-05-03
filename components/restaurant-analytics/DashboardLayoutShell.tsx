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
const AC_TEXT = "#FBBF24";
const AC_DIM = "rgba(245,158,11,0.10)";
const AC_BORDER = "rgba(245,158,11,0.24)";

export type DashboardWorkspaceMeta = {
  restaurantName: string;
  plan: "growth" | "pro" | "premium";
  locations: Array<{ id?: string; name: string }>;
};

type NavItem = {
  label: string;
  href: string;
  match: string;
  roles: UserRole[];
};

const navItems: NavItem[] = [
  { label: "Overview", href: "/restaurant-analytics/overview", match: "/restaurant-analytics/overview", roles: ["superadmin", "tenant"] },
  { label: "Calls & Reservations", href: "/restaurant-analytics/overview", match: "/restaurant-analytics/overview", roles: ["superadmin", "tenant"] },
  { label: "Follow-ups", href: "/restaurant-analytics/quality", match: "/restaurant-analytics/quality", roles: ["superadmin", "tenant"] },
  { label: "Escalations", href: "/restaurant-analytics/handoffs", match: "/restaurant-analytics/handoffs", roles: ["superadmin", "tenant"] },
  { label: "Reports & Analytics", href: "/restaurant-analytics/locations", match: "/restaurant-analytics/locations", roles: ["superadmin", "tenant"] },
  { label: "Tenants", href: "/restaurant-analytics/tenants", match: "/restaurant-analytics/tenants", roles: ["superadmin"] },
];

const sidebarCopy = {
  fr: {
    nav: {
      Overview: "Vue globale",
      "Calls & Reservations": "Appels & réservations",
      "Follow-ups": "Suivis",
      Escalations: "Escalades",
      "Reports & Analytics": "Rapports & analytics",
      Tenants: "Clients",
    },
    workspace: "Espace restaurant",
    location: "Site",
    allLocations: "Tous les sites",
    connectedLocations: "sites connectés",
    superadminMode: "Mode superadmin",
    planSuffix: "Plan",
    live: "Live",
    upsellTitle: "Augmente tes réservations",
    growthUpsell: "Débloque les suivis WhatsApp + SMS et les analytics avancés pour récupérer plus de réservations.",
    proUpsell: "Débloque le reporting multi-sites, les flows personnalisés et le support dédié.",
    upgradePro: "Passer à Pro",
    explorePremium: "Explorer Premium",
    manager: "Manager",
    backToSite: "Retour au site",
  },
  en: {
    nav: {
      Overview: "Overview",
      "Calls & Reservations": "Calls & Reservations",
      "Follow-ups": "Follow-ups",
      Escalations: "Escalations",
      "Reports & Analytics": "Reports & Analytics",
      Tenants: "Tenants",
    },
    workspace: "Restaurant workspace",
    location: "Location",
    allLocations: "All locations",
    connectedLocations: "connected locations",
    superadminMode: "Superadmin Mode",
    planSuffix: "Plan",
    live: "Live",
    upsellTitle: "Increase your reservations",
    growthUpsell: "Unlock WhatsApp + SMS follow-ups and advanced analytics to recover more bookings.",
    proUpsell: "Unlock multi-location reporting, custom flows, and dedicated support.",
    upgradePro: "Upgrade to Pro",
    explorePremium: "Explore Premium",
    manager: "Manager",
    backToSite: "Back to site",
  },
} as const;

export default function DashboardLayoutShell({
  children,
  userContext,
  workspace,
}: {
  children: ReactNode;
  userContext: UserContext;
  workspace: DashboardWorkspaceMeta;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [lang, setLang] = useRestaurantLanguage();
  const tenantCopy = restaurantCommonCopy[lang].dashboard;
  const t = sidebarCopy[lang];
  const [isSigningOut, setIsSigningOut] = useState(false);
  const modeLabel = userContext.role === "superadmin" ? t.superadminMode : `${workspace.plan.toUpperCase()} ${t.planSuffix}`;
  const visibleNavItems = navItems.filter((item) => item.roles.includes(userContext.role));
  const primaryLocation = workspace.locations[0]?.name ?? t.allLocations;
  const showUpsell = workspace.plan !== "premium";

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
        className="dashboard-shell-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "260px minmax(0, 1fr)",
          minHeight: "100vh",
        }}
      >
        <aside
          className="dashboard-sidebar"
          style={{
            borderRight: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(7,17,31,0.78)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            padding: "22px 18px",
            position: "sticky",
            top: 0,
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
            overflowX: "hidden",
            boxSizing: "border-box",
            paddingBottom: 28,
          }}
        >
          <Link
            href="/restaurant-analytics/overview"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              textDecoration: "none",
              marginBottom: 24,
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
              <span style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 800, lineHeight: 1.15 }}>
                {workspace.restaurantName}
              </span>
              <span style={{ color: "rgba(255,255,255,0.38)", fontSize: 11 }}>
                {t.workspace}
              </span>
            </span>
          </Link>

          <div
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.035)",
              borderRadius: 16,
              padding: 12,
              marginBottom: 16,
            }}
          >
            <p
              style={{
                color: "rgba(255,255,255,0.38)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              {t.location}
            </p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <p style={{ color: "#f0f0ef", fontSize: 13, fontWeight: 800, lineHeight: 1.35 }}>
                {workspace.plan === "premium" && workspace.locations.length > 1 ? t.allLocations : primaryLocation}
              </p>
              <span style={{ color: AC_TEXT, fontSize: 12 }}>⌄</span>
            </div>
            {workspace.locations.length > 1 && (
              <p style={{ color: "rgba(255,255,255,0.40)", fontSize: 11.5, lineHeight: 1.4, marginTop: 7 }}>
                {workspace.locations.length} {t.connectedLocations}
              </p>
            )}
          </div>

          <nav className="dashboard-nav" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {visibleNavItems.map((item) => {
              const isActive =
                pathname === item.match ||
                Boolean(pathname?.startsWith(`${item.match}/`));

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
                    fontWeight: 700,
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
                  {t.nav[item.label as keyof typeof t.nav]}
                  {isActive && <span style={{ fontSize: 11 }}>{t.live}</span>}
                </Link>
              );
            })}
          </nav>

          {showUpsell && (
            <div
              style={{
                border: `1px solid ${AC_BORDER}`,
                background: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(255,255,255,0.03))",
                borderRadius: 18,
                padding: 16,
                marginTop: 18,
              }}
            >
              <h3 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 15, marginBottom: 8 }}>
                {t.upsellTitle}
              </h3>
              <p style={{ color: "rgba(255,255,255,0.58)", fontSize: 12.5, lineHeight: 1.55, marginBottom: 13 }}>
                {workspace.plan === "growth"
                  ? t.growthUpsell
                  : t.proUpsell}
              </p>
              <Link
                href="/agent/restaurant-call-assistant#pricing"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 34,
                  padding: "8px 12px",
                  borderRadius: 999,
                  background: AC,
                  color: "#160b02",
                  fontSize: 12,
                  fontWeight: 900,
                  textDecoration: "none",
                }}
              >
                {workspace.plan === "growth" ? t.upgradePro : t.explorePremium}
              </Link>
            </div>
          )}

          <div
            style={{
              marginTop: 16,
              paddingTop: 16,
              borderTop: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.035)", borderRadius: 16, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: AC_DIM, border: `1px solid ${AC_BORDER}`, color: AC_TEXT, display: "grid", placeItems: "center", fontWeight: 900 }}>
                  {userContext.role === "superadmin" ? "S" : "M"}
                </span>
                <span style={{ minWidth: 0 }}>
                  <p style={{ color: "#f0f0ef", fontSize: 13, fontWeight: 800 }}>{t.manager}</p>
                  <p style={{ color: "rgba(255,255,255,0.40)", fontSize: 11 }}>{modeLabel}</p>
                </span>
              </div>
              <span style={{ color: AC_TEXT, border: `1px solid ${AC_BORDER}`, background: AC_DIM, borderRadius: 999, padding: "5px 8px", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>
                AI Restaurant Call Assistant
              </span>
            </div>
            <Link
              href="/agent/restaurant-call-assistant"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1px solid ${AC_BORDER}`,
                background: AC_DIM,
                color: AC_TEXT,
                borderRadius: 999,
                padding: "9px 12px",
                fontSize: 12.5,
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              {userContext.role === "tenant" ? tenantCopy.servicePage : "Service page"}
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
              {t.backToSite}
            </Link>
          </div>
        </aside>

        <main className="dashboard-main" style={{ minWidth: 0, padding: "28px clamp(18px, 3vw, 36px) 48px" }}>
          {children}
        </main>
      </div>
    </section>
  );
}
