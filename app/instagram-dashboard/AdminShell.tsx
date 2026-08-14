"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import AdminSidebar from "./AdminSidebar";
import type { NotificationItem } from "./radar-data";

const COLLAPSE_KEY = "iad_sidebar_collapsed";
const MOBILE_SIDEBAR_QUERY = "(max-width: 760px)";

function subscribeToMobileSidebar(callback: () => void) {
  const query = window.matchMedia(MOBILE_SIDEBAR_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getMobileSidebarSnapshot() {
  return window.matchMedia(MOBILE_SIDEBAR_QUERY).matches;
}

function getMobileSidebarServerSnapshot() {
  return false;
}

interface AdminShellProps {
  children: React.ReactNode;
  radarBadge?: number;
  serverCheckBadge?: number;
  radarNotifications?: NotificationItem[];
  serverCheckNotifications?: NotificationItem[];
  commercialAccess?: boolean;
}

export default function AdminShell({
  children,
  radarBadge = 0,
  serverCheckBadge = 0,
  radarNotifications = [],
  serverCheckNotifications = [],
  commercialAccess = false,
}: AdminShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const mobileSidebar = useSyncExternalStore(
    subscribeToMobileSidebar,
    getMobileSidebarSnapshot,
    getMobileSidebarServerSnapshot,
  );
  const effectiveCollapsed = collapsed || mobileSidebar;
  // `ready` delays the CSS transition until after hydration to prevent
  // an animate-on-load flash when restoring a collapsed state from localStorage.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(COLLAPSE_KEY) === "1";
    setCollapsed(saved);
    // Small RAF delay so the DOM settles before enabling transitions.
    requestAnimationFrame(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed, ready]);

  // Cmd+\ or Ctrl+\ keyboard shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateColumns: effectiveCollapsed ? "48px minmax(0, 1fr)" : "234px minmax(0, 1fr)",
        height: "100vh",
        overflow: "hidden",
        background: "#0c0d10",
        color: "#f0f0ee",
        fontFamily: '"Inter", system-ui, sans-serif',
        fontSize: 13,
        WebkitFontSmoothing: "antialiased",
        transition: ready ? "grid-template-columns 200ms ease-in-out" : "none",
      }}
    >
      <AdminSidebar
        collapsed={effectiveCollapsed}
        onToggle={mobileSidebar ? undefined : () => setCollapsed((c) => !c)}
        radarBadge={radarBadge}
        serverCheckBadge={serverCheckBadge}
        radarNotifications={radarNotifications}
        serverCheckNotifications={serverCheckNotifications}
        commercialAccess={commercialAccess}
      />
      <div
        style={{
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
