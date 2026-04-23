"use client";

// ============================================================
// NavbarFooter.tsx — Shared layout component
// Usage:
//   import NavbarFooter from "@/components/NavbarFooter";
//
//   <NavbarFooter agent="whatsapp" lang={lang} onLangChange={setLang}>
//     {/* page content */}
//   </NavbarFooter>
//
// agent prop: "whatsapp" | "assistant" | "ugc" | "support" | "restaurant" | undefined
// The "B" logo mark and CTA button take the agent's accent color.
// Passing no agent (homepage) keeps the logo neutral white.
// ============================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Agent = "whatsapp" | "assistant" | "ugc" | "support" | "restaurant";
type Lang = "fr" | "en";

const AGENT_COLORS: Record<Agent, string> = {
  whatsapp: "#25D366",
  assistant: "#8B7CF6",
  ugc: "#F97316",
  support: "#3B82F6",
  restaurant: "#F59E0B",
};

const AGENT_HOVER: Record<Agent, string> = {
  whatsapp: "rgba(37,211,102,0.10)",
  assistant: "rgba(139,124,246,0.10)",
  ugc: "rgba(249,115,22,0.10)",
  support: "rgba(59,130,246,0.10)",
  restaurant: "rgba(245,158,11,0.10)",
};

const NAV_LINKS = [
  { label: { fr: "UGC Ads Engine", en: "UGC Ads Engine" }, href: "/agent/ugc-ads-engine", agent: "ugc" as Agent },
  { label: { fr: "AI Assistant", en: "AI Assistant" }, href: "/agent/general", agent: "assistant" as Agent },
  { label: { fr: "WhatsApp Leads", en: "WhatsApp Leads" }, href: "/agent/whatsapp-lead-system", agent: "whatsapp" as Agent },
  { label: { fr: "AI Restaurant Call Assistant", en: "AI Restaurant Call Assistant" }, href: "/agent/restaurant-call-assistant", agent: "restaurant" as Agent },
  { label: { fr: "Support Agent", en: "Support Agent" }, href: "/agent/support", agent: "support" as Agent },
];

const COPY = {
  fr: {
    cta: "Commencer",
    tagline: "Des agents IA pour de vrais workflows business. Aucune compétence en prompting requise.",
    agents: "Agents",
    legal: "Légal",
    privacy: "Politique de confidentialité",
    terms: "Conditions d'utilisation",
    mentions: "Mentions légales",
    copy: "© 2025 BoostMyBusinesses. Tous droits réservés.",
    made: "Fait avec IA — conçu pour les humains.",
    pricing: "Tarifs",
    about: "À propos",
    contact: "Contact",
  },
  en: {
    cta: "Get started",
    tagline: "AI agents built for real business workflows. No prompting skills required.",
    agents: "Agents",
    legal: "Legal",
    privacy: "Privacy policy",
    terms: "Terms of service",
    mentions: "Mentions légales",
    copy: "© 2025 BoostMyBusinesses. All rights reserved.",
    made: "Made with AI — built for humans.",
    pricing: "Pricing",
    about: "About",
    contact: "Contact",
  },
};

interface NavbarFooterProps {
  agent?: Agent;
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  children: React.ReactNode;
}

export default function NavbarFooter({
  agent,
  lang,
  onLangChange,
  children,
}: NavbarFooterProps) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const accentColor = agent ? AGENT_COLORS[agent] : "#f0f0ef";
  const accentHover = agent ? AGENT_HOVER[agent] : "rgba(255,255,255,0.06)";
  const t = COPY[lang];

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <>
      {/* ── NAVBAR ── */}
      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          height: 60,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          justifyContent: "space-between",
          gap: 16,
          background: scrolled ? "rgba(7,17,31,0.90)" : "transparent",
          backdropFilter: scrolled ? "blur(20px) saturate(150%)" : "none",
          WebkitBackdropFilter: scrolled ? "blur(20px) saturate(150%)" : "none",
          borderBottom: scrolled ? "1px solid rgba(255,255,255,0.07)" : "1px solid transparent",
          transition: "background 300ms ease, border-color 300ms ease, backdrop-filter 300ms ease",
        }}
      >
        {/* Logo */}
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", flexShrink: 0 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: accentColor,
              color: "#000",
              fontFamily: "'Syne', sans-serif",
              fontSize: 15,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 300ms ease",
            }}
          >
            B
          </span>
          <span
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color: "#f0f0ef",
              letterSpacing: "-0.01em",
            }}
          >
            Boost
            <span style={{ color: "rgba(255,255,255,0.40)", fontWeight: 400 }}>My</span>
            Businesses
          </span>
        </Link>

        {/* Nav links — desktop */}
        <nav
          style={{
            display: "flex",
            gap: 2,
            flex: 1,
            minWidth: 0,
            justifyContent: "center",
          }}
          className="nav-links-desktop"
        >
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname?.startsWith(link.href);
            const linkColor = AGENT_COLORS[link.agent];
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  padding: "5px 12px",
                  fontSize: 13,
                  fontWeight: 500,
                  color: isActive ? linkColor : "rgba(255,255,255,0.50)",
                  textDecoration: "none",
                  borderRadius: 999,
                  background: isActive ? `rgba(255,255,255,0.06)` : "transparent",
                  transition: "color 150ms, background 150ms",
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = linkColor;
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.50)";
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }
                }}
              >
                {link.label[lang]}
              </Link>
            );
          })}
        </nav>

        {/* Right side */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, position: "relative", zIndex: 1 }}>
          {/* Lang toggle */}
          <div
            style={{
              display: "flex",
              position: "relative",
              zIndex: 1,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 999,
              padding: 3,
              gap: 2,
            }}
          >
            {(["fr", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onLangChange(l)}
                style={{
                  height: 26,
                  width: 36,
                  borderRadius: 999,
                  border: "none",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                  background: lang === l ? "rgba(255,255,255,0.10)" : "transparent",
                  color: lang === l ? "#f0f0ef" : "rgba(255,255,255,0.35)",
                  transition: "all 150ms",
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>

          {/* CTA */}
          <Link
            href="/#pricing"
            style={{
              padding: "8px 18px",
              background: accentColor,
              color: "#000",
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 999,
              textDecoration: "none",
              transition: "opacity 150ms, background 300ms ease",
              display: "inline-flex",
              alignItems: "center",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.88"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            {t.cta}
          </Link>

          {/* Hamburger — mobile */}
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
            style={{
              display: "none", // shown via media query in global CSS
              flexDirection: "column",
              gap: 5,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 6,
            }}
            className="nav-hamburger"
          >
            <span style={{ width: 20, height: 1.5, background: "#f0f0ef", borderRadius: 2, display: "block" }} />
            <span style={{ width: 20, height: 1.5, background: "#f0f0ef", borderRadius: 2, display: "block" }} />
            <span style={{ width: 20, height: 1.5, background: "#f0f0ef", borderRadius: 2, display: "block" }} />
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div
            style={{
              position: "absolute",
              top: 60,
              left: 0,
              right: 0,
              background: "rgba(7,17,31,0.97)",
              backdropFilter: "blur(20px)",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              padding: "12px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                style={{
                  padding: "10px 14px",
                  fontSize: 14,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.75)",
                  textDecoration: "none",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                {link.label[lang]}
              </Link>
            ))}
          </div>
        )}
      </header>

      {/* ── PAGE CONTENT ── */}
      <div style={{ paddingTop: 60 }}>
        {children}
      </div>

      {/* ── FOOTER ── */}
      <footer
        style={{
          borderTop: "1px solid rgba(255,255,255,0.07)",
          padding: "48px 24px 28px",
          marginTop: 0,
          background: "rgba(255,255,255,0.015)",
        }}
      >
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr",
              gap: 48,
              marginBottom: 40,
            }}
          >
            {/* Brand */}
            <div>
              <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", marginBottom: 14 }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 5,
                    background: accentColor,
                    color: "#000",
                    fontFamily: "'Syne', sans-serif",
                    fontSize: 13,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "background 300ms ease",
                  }}
                >
                  B
                </span>
                <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 600, color: "#f0f0ef" }}>
                  Boost<span style={{ color: "rgba(255,255,255,0.38)", fontWeight: 400 }}>My</span>Businesses
                </span>
              </Link>
              <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.38)", lineHeight: 1.65, maxWidth: 240 }}>
                {t.tagline}
              </p>
            </div>

            {/* Agents */}
            <div>
              <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.26)", marginBottom: 14 }}>
                {t.agents}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    style={{ fontSize: 13, color: "rgba(255,255,255,0.48)", textDecoration: "none", transition: "color 150ms" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = AGENT_COLORS[link.agent]; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.48)"; }}
                  >
                    {link.label[lang]}
                  </Link>
                ))}
              </div>
            </div>

            {/* Company */}
            <div>
              <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.26)", marginBottom: 14 }}>
                Company
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { label: t.pricing, href: "/#pricing" },
                  { label: t.about, href: "/about" },
                  { label: t.contact, href: "/contact" },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{ fontSize: 13, color: "rgba(255,255,255,0.48)", textDecoration: "none", transition: "color 150ms" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#f0f0ef"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.48)"; }}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* Legal */}
            <div>
              <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.26)", marginBottom: 14 }}>
                {t.legal}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { label: t.privacy, href: "/privacy" },
                  { label: t.terms, href: "/terms" },
                  { label: t.mentions, href: "/mentions" },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{ fontSize: 13, color: "rgba(255,255,255,0.48)", textDecoration: "none", transition: "color 150ms" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#f0f0ef"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.48)"; }}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 20,
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.22)" }}>
              {t.copy}
            </p>
            <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.22)" }}>
              {t.made}
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
