"use client";

import { useEffect, useState } from "react";
import AdminSidebar from "./AdminSidebar";

const COLLAPSE_KEY = "iad_sidebar_collapsed";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
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
        gridTemplateColumns: collapsed ? "48px 1fr" : "234px 1fr",
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
      {/* overflow: visible lets the toggle button extend past the sidebar edge */}
      <div style={{ overflow: "visible", position: "relative", height: "100%" }}>
        <AdminSidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
        />
      </div>
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
