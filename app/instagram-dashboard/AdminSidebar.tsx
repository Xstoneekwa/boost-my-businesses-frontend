"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { NotificationItem } from "./radar-data";

type NavItem = {
  key: string;
  label: string;
  href: string;
  exact?: boolean;
  icon: React.ReactNode;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

type BadgeKey = "radar" | "server-check";

interface PopoverPosition { top: number; left: number; width: number; }

interface AdminSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  radarBadge?: number;
  serverCheckBadge?: number;
  radarNotifications?: NotificationItem[];
  serverCheckNotifications?: NotificationItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      {
        key: "manage",
        label: "Manage",
        href: "/instagram-dashboard",
        exact: true,
        icon: (
          <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        ),
      },
      {
        key: "radar",
        label: "Radar",
        href: "/instagram-dashboard/radar",
        icon: (
          <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          </svg>
        ),
      },
      {
        key: "server-check",
        label: "Server Check",
        href: "/instagram-dashboard/server-check",
        icon: (
          <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" strokeWidth={2.5} /><line x1="6" y1="18" x2="6.01" y2="18" strokeWidth={2.5} />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      {
        key: "devices",
        label: "Devices",
        href: "/instagram-dashboard/devices",
        icon: (
          <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" />
            <line x1="12" y1="18" x2="12" y2="18.01" strokeWidth={2.5} />
          </svg>
        ),
      },
      {
        key: "activity-log",
        label: "Activity Log",
        href: "/instagram-dashboard/activity-log",
        icon: (
          <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        ),
      },
      {
        key: "dm-templates",
        label: "DM Templates",
        href: "/instagram-dashboard/dm-templates",
        icon: (
          <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
      {
        key: "credentials",
        label: "Credentials",
        href: "/instagram-dashboard/credentials-actions",
        icon: (
          <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        ),
      },
      {
        key: "growth",
        label: "Growth",
        href: "/instagram-dashboard/growth-settings",
        icon: (
          <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Automation",
    items: [
      {
        key: "auto-restart",
        label: "Auto Restart",
        href: "/instagram-dashboard/auto-restart",
        icon: (
          <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        ),
      },
      {
        key: "client-accounts",
        label: "Accounts",
        href: "/instagram-dashboard/client-accounts",
        icon: (
          <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        ),
      },
    ],
  },
];

function isActive(href: string, pathname: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

// Chevron icons for the toggle button
function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" width={10} height={10} stroke="currentColor" fill="none" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" width={10} height={10} stroke="currentColor" fill="none" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function AdminSidebar({
  collapsed = false,
  onToggle,
  radarBadge = 0,
  serverCheckBadge = 0,
  radarNotifications = [],
  serverCheckNotifications = [],
}: AdminSidebarProps) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  // Popover state — mirrors InstagramDashboardViewNav behavior
  const [openKey, setOpenKey] = useState<BadgeKey | null>(null);
  const [popoverPos, setPopoverPos] = useState<PopoverPosition | null>(null);
  const badgeRefs = useRef<Partial<Record<BadgeKey, HTMLButtonElement | null>>>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const badges: Partial<Record<BadgeKey, number>> = {
    radar: radarBadge,
    "server-check": serverCheckBadge,
  };
  const notificationItems: Partial<Record<BadgeKey, NotificationItem[]>> = {
    radar: radarNotifications,
    "server-check": serverCheckNotifications,
  };

  function clearCloseTimer() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }

  function positionPopover(key: BadgeKey) {
    const el = badgeRefs.current[key];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxWidth = 360;
    const gutter = 14;
    const width = Math.min(maxWidth, window.innerWidth - gutter * 2);
    // Place popover to the right of the sidebar
    const left = Math.min(Math.max(gutter, rect.right + 8), window.innerWidth - width - gutter);
    setPopoverPos({ top: rect.top, left, width });
  }

  function openPopover(key: BadgeKey) {
    clearCloseTimer();
    setOpenKey(key);
    positionPopover(key);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => { setOpenKey(null); setPopoverPos(null); }, 180);
  }

  function togglePopover(key: BadgeKey) {
    clearCloseTimer();
    if (openKey === key) { setOpenKey(null); setPopoverPos(null); return; }
    setOpenKey(key);
    positionPopover(key);
  }

  useEffect(() => {
    if (!openKey) return;
    const currentKey = openKey;
    function handlePointerDown(e: PointerEvent) {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest(".iad-sb-nav") || t.closest(".iad-notification-popover")) return;
      setOpenKey(null); setPopoverPos(null);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpenKey(null); setPopoverPos(null);
    }
    function handleReposition() { positionPopover(currentKey); }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [openKey]);

  useEffect(() => { return () => clearCloseTimer(); }, []);

  const openItems = openKey ? (notificationItems[openKey] ?? []) : [];

  return (
  <>
    <aside style={{
      background: "#111213",
      borderRight: "1px solid rgba(255,255,255,.07)",
      display: "flex",
      flexDirection: "column",
      overflow: "visible",
      height: "100%",
      position: "relative",
    }}>

      {/* ── Toggle button — rendered only after hydration to avoid SSR mismatch ── */}
      {ready && onToggle && (
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? "Expand sidebar (Ctrl+\\)" : "Collapse sidebar (Ctrl+\\)"}
          style={{
            position: "absolute",
            right: -12,
            top: 22,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "#2a2d3a",
            border: "1px solid rgba(255,255,255,.15)",
            color: "#8a8f98",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            zIndex: 50,
            transition: "border-color .13s ease, color .13s ease, background .13s ease",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "#f0f0ee";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,.35)";
            (e.currentTarget as HTMLElement).style.background = "#363a4f";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "#8a8f98";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,.15)";
            (e.currentTarget as HTMLElement).style.background = "#2a2d3a";
          }}
        >
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>
      )}

      {/* ── Brand row ── */}
      <div style={{
        padding: collapsed ? "16px 0 12px" : "16px 14px 12px",
        borderBottom: "1px solid rgba(255,255,255,.07)",
        flexShrink: 0,
        display: "flex",
        justifyContent: collapsed ? "center" : "flex-start",
        alignItems: "center",
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: "#6558f5",
          display: "grid", placeItems: "center",
          flexShrink: 0,
        }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="#fff">
            <path d="M6 4h7a4 4 0 0 1 0 8H6V4z" />
            <path d="M6 12h8a4 4 0 0 1 0 8H6z" opacity=".6" />
          </svg>
        </div>
        {!collapsed && (
          <div style={{ marginLeft: 9 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-.01em", lineHeight: 1.1, color: "#f0f0ee" }}>
              BotApp Admin
            </div>
            <div style={{ fontSize: 10, fontWeight: 400, color: "#4a4f5c", letterSpacing: ".04em", textTransform: "uppercase", marginTop: 1 }}>
              Automation Dashboard
            </div>
          </div>
        )}
      </div>

      {/* ── Nav ── */}
      <nav style={{
        flex: 1,
        padding: collapsed ? "10px 4px" : "10px 8px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}>
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label}>
            {/* Section label — hidden when collapsed */}
            {!collapsed && (
              <div style={{
                fontSize: 10, fontWeight: 500, letterSpacing: ".1em",
                textTransform: "uppercase", color: "#4a4f5c",
                padding: "10px 8px 4px",
                marginTop: gi === 0 ? 0 : 6,
              }}>
                {group.label}
              </div>
            )}
            {collapsed && gi > 0 && (
              <div style={{ height: 8 }} />
            )}
            {group.items.map((item) => {
              const active = isActive(item.href, pathname, item.exact);
              const badgeKey = (item.key === "radar" || item.key === "server-check") ? item.key as BadgeKey : null;
              const badgeCount = badgeKey ? (badges[badgeKey] ?? 0) : 0;
              const hasItems = badgeKey ? (notificationItems[badgeKey]?.length ?? 0) > 0 : false;
              return (
                <div
                  key={item.key}
                  style={{ position: "relative", display: "flex", alignItems: "center" }}
                  onMouseEnter={hasItems ? () => openPopover(badgeKey!) : undefined}
                  onMouseLeave={hasItems ? scheduleClose : undefined}
                >
                <Link
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: collapsed ? "center" : "flex-start",
                    gap: collapsed ? 0 : 9,
                    padding: collapsed ? "8px 0" : "7px 9px",
                    borderRadius: 5,
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: active ? "#6558f5" : "#8a8f98",
                    background: active ? "rgba(101,88,245,.18)" : "transparent",
                    textDecoration: "none",
                    transition: "all .13s ease",
                    position: "relative",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.background = "#191b1e";
                      (e.currentTarget as HTMLElement).style.color = "#f0f0ee";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.color = "#8a8f98";
                    }
                  }}
                >
                  {active && !collapsed && (
                    <span style={{
                      position: "absolute", left: 0, top: "20%", height: "60%",
                      width: 2.5, background: "#6558f5",
                      borderRadius: "0 2px 2px 0",
                    }} />
                  )}
                  <span style={{ opacity: active ? 1 : 0.8, flexShrink: 0 }}>
                    {item.icon}
                  </span>
                  {!collapsed && <span>{item.label}</span>}
                </Link>
                {/* Badge pill — only on radar and server-check, only when count > 0 */}
                {badgeKey && badgeCount > 0 && (
                  <button
                    ref={(node) => { badgeRefs.current[badgeKey] = node; }}
                    type="button"
                    aria-expanded={openKey === badgeKey}
                    aria-haspopup="dialog"
                    aria-label={`${item.label}: ${badgeCount} open notifications`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePopover(badgeKey); }}
                    onFocus={hasItems ? () => openPopover(badgeKey) : undefined}
                    style={{
                      position: "absolute",
                      right: 6,
                      top: "50%",
                      transform: "translateY(-50%)",
                      minWidth: 18,
                      height: 18,
                      borderRadius: 9999,
                      border: openKey === badgeKey
                        ? "1px solid rgba(248,113,113,0.38)"
                        : "1px solid rgba(248,113,113,0.20)",
                      background: openKey === badgeKey
                        ? "rgba(248,113,113,0.24)"
                        : "rgba(248,113,113,0.16)",
                      color: openKey === badgeKey ? "#FECACA" : "#FCA5A5",
                      cursor: "pointer",
                      fontSize: 10,
                      fontFamily: "var(--font-d, 'Archivo', sans-serif)",
                      fontWeight: 700,
                      lineHeight: 1,
                      padding: "0 5px",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {badgeCount}
                  </button>
                )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Service page link */}
        <Link
          href="/instagram-growth"
          target="_blank"
          rel="noopener noreferrer"
          title={collapsed ? "Service page" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: collapsed ? 0 : 9,
            padding: collapsed ? "8px 0" : "7px 9px",
            borderRadius: 5,
            fontSize: 12.5,
            fontWeight: 500,
            color: "#8a8f98",
            background: "transparent",
            textDecoration: "none",
            transition: "all .13s ease",
            whiteSpace: "nowrap",
            marginTop: 6,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "#191b1e";
            (e.currentTarget as HTMLElement).style.color = "#f0f0ee";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "#8a8f98";
          }}
        >
          <span style={{ opacity: 0.8, flexShrink: 0 }}>
            <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </span>
          {!collapsed && <span>Service page</span>}
        </Link>
      </nav>

      {/* ── User row ── */}
      <div style={{
        padding: collapsed ? "10px 4px 12px" : "10px 10px 12px",
        borderTop: "1px solid rgba(255,255,255,.07)",
        flexShrink: 0,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: collapsed ? 0 : 9,
          padding: collapsed ? "6px 0" : "8px 9px",
          borderRadius: 5,
          background: "#1e2028",
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            background: "linear-gradient(135deg,#6558f5,#0d9488)",
            display: "grid", placeItems: "center",
            fontSize: 11, fontWeight: 700, color: "#fff",
            flexShrink: 0,
          }}>
            A
          </div>
          {!collapsed && (
            <>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#f0f0ee", lineHeight: 1.2 }}>admin</div>
                <div style={{ fontSize: 10, color: "#4a4f5c", letterSpacing: ".03em" }}>Super Admin</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 3, marginLeft: "auto" }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "#22c55e",
                  animation: "iad-blink 2s ease-in-out infinite",
                }} />
              </div>
            </>
          )}
        </div>
      </div>
    </aside>

    {/* ── Notification popover — same behavior as InstagramDashboardViewNav ── */}
    {openKey && openItems.length > 0 && popoverPos && (
      <div
        className="iad-notification-popover"
        role="dialog"
        aria-label="Open notifications"
        onMouseEnter={clearCloseTimer}
        onMouseLeave={scheduleClose}
        style={{
          position: "fixed",
          top: popoverPos.top,
          left: popoverPos.left,
          width: popoverPos.width,
          zIndex: 999,
          display: "grid",
          gap: 8,
          maxHeight: "min(420px, calc(100vh - 28px))",
          overflow: "auto",
          border: "1px solid rgba(255,255,255,.10)",
          borderRadius: 14,
          background: "rgba(14,14,15,0.98)",
          boxShadow: "0 18px 50px rgba(0,0,0,0.36)",
          padding: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "4px 4px 8px" }}>
          <span style={{ color: "rgba(255,255,255,0.42)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Open cases
          </span>
          <strong style={{ color: "#f0f0ef", fontSize: 12 }}>{openItems.length}</strong>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {openItems.slice(0, 8).map((item) => (
            <Link
              key={item.id}
              href={item.targetHref}
              style={{
                display: "grid",
                gap: 7,
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                background: "rgba(255,255,255,0.035)",
                padding: 10,
                textDecoration: "none",
              }}
            >
              <span style={{ color: "rgba(255,255,255,0.42)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {item.severity} · {item.status}
              </span>
              <strong style={{ color: "#f0f0ef", fontSize: 12 }}>{item.title}</strong>
              <p style={{ color: "rgba(255,255,255,0.64)", fontSize: 12, lineHeight: 1.45, margin: 0 }}>{item.reason}</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[item.phoneName, item.macHostName, item.sourceLabel,
                  item.backendResolutionStatus === "pending" ? "Needs backend resolution" : "Resolution available",
                ].map((meta) => (
                  <small key={meta} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999, padding: "4px 7px", color: "rgba(255,255,255,0.42)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
                    {meta}
                  </small>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </div>
    )}
  </>
  );
}
