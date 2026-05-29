"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NotificationItem } from "./radar-data";

type ViewKey = "manage" | "radar" | "server-check" | "devices" | "activity-log" | "dm-templates" | "credentials" | "growth";

type InstagramDashboardViewNavProps = {
  active: ViewKey;
  badges?: Partial<Record<ViewKey, number | null>>;
  notificationItems?: Partial<Record<ViewKey, NotificationItem[]>>;
};

type PopoverPosition = {
  top: number;
  left: number;
  width: number;
};

const navItems = [
  { key: "manage", label: "Manage", href: "/instagram-dashboard" },
  { key: "radar", label: "Radar", href: "/instagram-dashboard/radar" },
  { key: "server-check", label: "Server Check", href: "/instagram-dashboard/server-check" },
  { key: "devices", label: "Devices", href: "/instagram-dashboard/devices" },
  { key: "activity-log", label: "Activity Log", href: "/instagram-dashboard/activity-log" },
  { key: "dm-templates", label: "DM Templates", href: "/instagram-dashboard/dm-templates" },
  { key: "credentials", label: "Credentials", href: "/instagram-dashboard/credentials-actions" },
  { key: "growth", label: "Growth", href: "/instagram-dashboard/growth-settings" },
] as const;

export default function InstagramDashboardViewNav({ active, badges = {}, notificationItems = {} }: InstagramDashboardViewNavProps) {
  const [openKey, setOpenKey] = useState<ViewKey | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const badgeRefs = useRef<Partial<Record<ViewKey, HTMLButtonElement | null>>>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openItems = openKey ? notificationItems[openKey] ?? [] : [];

  function clearCloseTimer() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function positionPopover(key: ViewKey) {
    const badge = badgeRefs.current[key];
    if (!badge) return;

    const rect = badge.getBoundingClientRect();
    const maxWidth = 360;
    const gutter = 14;
    const width = Math.min(maxWidth, window.innerWidth - gutter * 2);
    const left = Math.min(Math.max(gutter, rect.right - width), window.innerWidth - width - gutter);

    setPosition({
      top: rect.bottom + 8,
      left,
      width,
    });
  }

  function openPopover(key: ViewKey) {
    clearCloseTimer();
    setOpenKey(key);
    positionPopover(key);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => {
      setOpenKey(null);
      setPosition(null);
    }, 180);
  }

  function togglePopover(key: ViewKey) {
    clearCloseTimer();
    if (openKey === key) {
      setOpenKey(null);
      setPosition(null);
      return;
    }

    setOpenKey(key);
    positionPopover(key);
  }

  useEffect(() => {
    if (!openKey) return;
    const currentKey = openKey;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".ig-view-nav") || target.closest(".ig-view-nav-popover")) return;
      setOpenKey(null);
      setPosition(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenKey(null);
      setPosition(null);
    }

    function handleReposition() {
      positionPopover(currentKey);
    }

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

  useEffect(() => {
    return () => clearCloseTimer();
  }, []);

  return (
    <nav aria-label="Instagram admin views" className="ig-view-nav">
      {navItems.map((item) => {
        const isActive = item.key === active;
        const badge = badges[item.key];
        const items = notificationItems[item.key] ?? [];
        const hasItems = items.length > 0;
        const isOpen = openKey === item.key;

        return (
          <div key={item.key} className="ig-view-nav-item" onMouseEnter={hasItems ? () => openPopover(item.key) : undefined} onMouseLeave={hasItems ? scheduleClose : undefined}>
            <Link
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={isActive ? "ig-view-nav-link ig-view-nav-link-active" : "ig-view-nav-link"}
            >
              <span>{item.label}</span>
            </Link>
            {typeof badge === "number" && badge > 0 ? (
              <button
                ref={(node) => {
                  badgeRefs.current[item.key] = node;
                }}
                type="button"
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                aria-label={`${item.label}: ${badge} open notifications`}
                className={isOpen ? "ig-view-nav-badge ig-view-nav-badge-active" : "ig-view-nav-badge"}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  togglePopover(item.key);
                }}
                onFocus={hasItems ? () => openPopover(item.key) : undefined}
              >
                {badge}
              </button>
            ) : null}
          </div>
        );
      })}

      {openKey && openItems.length > 0 && position ? (
        <NotificationPopover
          items={openItems}
          position={position}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
        />
      ) : null}

      <style>{`
        .ig-view-nav {
          position: relative;
          z-index: 80;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
          background: rgba(255,255,255,0.035);
          padding: 4px;
          overflow: visible;
        }

        .ig-view-nav-item {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }

        .ig-view-nav-link,
        .ig-view-nav-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 32px;
          border: 1px solid transparent;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          text-decoration: none;
          white-space: nowrap;
        }

        .ig-view-nav-link {
          color: rgba(255,255,255,0.62);
          padding: 0 10px;
        }

        .ig-view-nav-badge {
          min-width: 24px;
          height: 24px;
          min-height: 24px;
          border-color: rgba(248,113,113,0.20);
          background: rgba(248,113,113,0.16);
          color: #FCA5A5;
          cursor: pointer;
          font-size: 10px;
          line-height: 1;
          padding: 0 7px;
        }

        .ig-view-nav-link:hover,
        .ig-view-nav-link:focus-visible,
        .ig-view-nav-badge:hover,
        .ig-view-nav-badge:focus-visible,
        .ig-view-nav-badge-active {
          color: rgba(255,255,255,0.90);
          outline: none;
        }

        .ig-view-nav-badge:hover,
        .ig-view-nav-badge:focus-visible,
        .ig-view-nav-badge-active {
          border-color: rgba(248,113,113,0.38);
          background: rgba(248,113,113,0.24);
          color: #FECACA;
        }

        .ig-view-nav-link-active {
          border-color: rgba(245,158,11,0.40);
          background: rgba(245,158,11,0.14);
          color: #FBBF24;
        }

        .ig-view-nav-popover {
          position: fixed;
          z-index: 999;
          display: grid;
          gap: 8px;
          max-height: min(420px, calc(100vh - 28px));
          overflow: auto;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 14px;
          background: rgba(14,14,15,0.98);
          box-shadow: 0 18px 50px rgba(0,0,0,0.36);
          padding: 10px;
        }

        .ig-view-nav-popover header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          padding: 4px 4px 8px;
        }

        .ig-view-nav-popover header span,
        .ig-view-nav-popover-item span,
        .ig-view-nav-popover-item small {
          color: rgba(255,255,255,0.42);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-view-nav-popover header strong {
          color: #f0f0ef;
          font-size: 12px;
        }

        .ig-view-nav-popover-list {
          display: grid;
          gap: 8px;
        }

        .ig-view-nav-popover-item {
          display: grid;
          gap: 7px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          background: rgba(255,255,255,0.035);
          padding: 10px;
          text-decoration: none;
        }

        .ig-view-nav-popover-item:hover,
        .ig-view-nav-popover-item:focus-visible {
          border-color: rgba(245,158,11,0.38);
          background: rgba(245,158,11,0.08);
          outline: none;
        }

        .ig-view-nav-popover-item strong {
          color: #f0f0ef;
          font-size: 12px;
        }

        .ig-view-nav-popover-item p {
          color: rgba(255,255,255,0.64);
          font-size: 12px;
          line-height: 1.45;
          margin: 0;
        }

        .ig-view-nav-popover-meta {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .ig-view-nav-popover-meta small {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
          padding: 4px 7px;
        }
      `}</style>
    </nav>
  );
}

function NotificationPopover({
  items,
  position,
  onMouseEnter,
  onMouseLeave,
}: {
  items: NotificationItem[];
  position: PopoverPosition;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const visibleItems = items.slice(0, 8);

  return (
    <div
      className="ig-view-nav-popover"
      role="dialog"
      aria-label="Open notifications"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
      }}
    >
      <header>
        <span>Open cases</span>
        <strong>{items.length}</strong>
      </header>
      <div className="ig-view-nav-popover-list">
        {visibleItems.map((item) => (
          <Link key={item.id} href={item.targetHref} className="ig-view-nav-popover-item">
            <span>{item.severity} · {item.status}</span>
            <strong>{item.title}</strong>
            <p>{item.reason}</p>
            <div className="ig-view-nav-popover-meta">
              <small>{item.phoneName}</small>
              <small>{item.macHostName}</small>
              <small>{item.sourceLabel}</small>
              <small>{item.backendResolutionStatus === "pending" ? "Needs backend resolution" : "Resolution available"}</small>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
