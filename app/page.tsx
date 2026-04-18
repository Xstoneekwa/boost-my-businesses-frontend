"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import NavbarFooter from "./components/NavbarFooter";

type Lang = "fr" | "en";

const LANG_KEY = "boost_ai_landing_lang_v1";

const copy = {
  fr: {
    badge: "SaaS Multi-Agents",
    title: "Des agents IA qui font gagner du temps, capturent plus de leads et convertissent mieux.",
    subtitle:
      "Automatise tes ventes, ton support et ta génération de leads avec des systèmes IA qui répondent 24h/24, qualifient les prospects, prennent des rendez-vous et réduisent la charge de ton équipe.",
    primaryCta: "Découvrir l'Assistant Personnel",
    secondaryCta: "Découvrir UGC Ads Engine",
    proof: [
      "Réponses instantanées 24/7",
      "Moins de charge manuelle",
      "Plus de leads traités sans recruter",
    ],
    agentsTitle: "Des systèmes conçus pour des résultats business",
    agents: [
      {
        label: "Agent 01",
        title: "Assistant Personnel IA",
        desc: "Centralise les demandes, exécute des actions, aide à traiter les tâches répétitives et fluidifie les opérations du quotidien.",
        result: "Gagne du temps et automatise les opérations à faible valeur.",
        href: "/agent/general",
        link: "Ouvrir la page →",
        accent: "#8B7CF6",
        accentDim: "rgba(139,124,246,0.12)",
        accentBorder: "rgba(139,124,246,0.22)",
      },
      {
        label: "Agent 02",
        title: "AI WhatsApp Lead Handling System",
        desc: "Répond instantanément aux leads WhatsApp, détecte l'intention, pousse à la réservation, transfère à un humain si nécessaire et gère les urgences.",
        result: "Capture plus de leads et augmente la conversion sans ralentir l'équipe.",
        href: "/agent/whatsapp-lead-system",
        link: "Ouvrir la page →",
        accent: "#25D366",
        accentDim: "rgba(37,211,102,0.10)",
        accentBorder: "rgba(37,211,102,0.20)",
      },
      {
        label: "Agent 03",
        title: "UGC Ads Engine",
        desc: "Transforme une simple idée ou image en vidéo UGC structurée avec script, hook, narration, direction vidéo, contrôle qualité et logique de fallback.",
        result: "Produit plus vite du contenu marketing prêt à publier et pensé pour convertir.",
        href: "/agent/ugc-ads-engine",
        link: "Ouvrir la page →",
        accent: "#F97316",
        accentDim: "rgba(249,115,22,0.10)",
        accentBorder: "rgba(249,115,22,0.20)",
      },
      {
        label: "Agent 04",
        title: "Agent Support IA",
        desc: "Gère les demandes fréquentes, automatise les FAQ et absorbe une partie du support avant intervention humaine.",
        result: "Réduit la charge support et améliore le temps de réponse client.",
        href: "/agent/support",
        link: "Ouvrir la page →",
        accent: "#3B82F6",
        accentDim: "rgba(59,130,246,0.10)",
        accentBorder: "rgba(59,130,246,0.20)",
      },
    ],
    useCasesTitle: "Cas d'usage",
    useCasesText:
      "Ces systèmes peuvent être adaptés à plusieurs activités qui ont besoin de répondre vite, qualifier des demandes, automatiser une partie du suivi ou produire du contenu marketing plus rapidement.",
    useCases: [
      "Cliniques et cabinets médicaux",
      "Dentistes et opticiens",
      "Agences et consultants",
      "Centres de formation",
      "Beauty, spa, salons",
      "Immobilier et services locaux",
      "E-commerce et marques DTC",
      "Créateurs et agences ads",
    ],
    pricingTitle: "Offres",
    pricingText:
      "Une manière simple de présenter tes automatisations comme des offres concrètes et vendables.",
    pricing: [
      {
        name: "Starter",
        price: "À partir de 299€",
        description: "Une automatisation ciblée pour un besoin précis.",
        bullets: ["1 système IA", "1 cas d'usage principal", "Setup de base"],
        featured: false,
      },
      {
        name: "Growth",
        price: "À partir de 799€",
        description: "Plus de logique, plus d'intégrations, plus d'impact business.",
        bullets: ["1 à 2 systèmes IA", "Connexions outils métier", "Optimisé pour conversion / gain de temps"],
        featured: true,
      },
      {
        name: "Custom",
        price: "Sur devis",
        description: "Architecture sur mesure pour besoin plus avancé.",
        bullets: ["Multi-flows", "Automatisations métier", "Support et évolution possibles"],
        featured: false,
      },
    ],
    bottomTitle: "Pourquoi cette structure est importante",
    bottomText:
      "Au lieu de montrer une simple démo générique, tu peux envoyer tes clients directement vers la page qui correspond à leur besoin. Ton offre devient plus claire, plus premium et plus facile à vendre.",
    featuredBadge: "Le plus populaire",
    outcomeLabelFr: "Résultat :",
  },
  en: {
    badge: "Multi-Agent SaaS",
    title: "AI agents that save time, capture more leads, and help businesses convert faster.",
    subtitle:
      "Automate sales, support, and lead generation with AI systems that reply 24/7, qualify prospects, book appointments, and reduce team workload.",
    primaryCta: "Explore Personal Assistant",
    secondaryCta: "Explore UGC Ads Engine",
    proof: [
      "Instant replies 24/7",
      "Less manual workload",
      "More leads handled without hiring",
    ],
    agentsTitle: "Systems designed for business outcomes",
    agents: [
      {
        label: "Agent 01",
        title: "AI Personal Assistant",
        desc: "Centralizes requests, executes actions, helps with repetitive tasks, and streamlines day-to-day operations.",
        result: "Save time and automate low-value operations.",
        href: "/agent/general",
        link: "Open page →",
        accent: "#8B7CF6",
        accentDim: "rgba(139,124,246,0.12)",
        accentBorder: "rgba(139,124,246,0.22)",
      },
      {
        label: "Agent 02",
        title: "AI WhatsApp Lead Handling System",
        desc: "Replies instantly to WhatsApp leads, detects intent, pushes booking, hands off to human staff when needed, and handles urgent cases.",
        result: "Capture more leads and improve conversion without slowing down your team.",
        href: "/agent/whatsapp-lead-system",
        link: "Open page →",
        accent: "#25D366",
        accentDim: "rgba(37,211,102,0.10)",
        accentBorder: "rgba(37,211,102,0.20)",
      },
      {
        label: "Agent 03",
        title: "UGC Ads Engine",
        desc: "Turns a simple idea or image into a structured UGC video with script, hook, narrative flow, video direction, quality control, and fallback logic.",
        result: "Produce ready-to-publish marketing content faster and with more consistency.",
        href: "/agent/ugc-ads-engine",
        link: "Open page →",
        accent: "#F97316",
        accentDim: "rgba(249,115,22,0.10)",
        accentBorder: "rgba(249,115,22,0.20)",
      },
      {
        label: "Agent 04",
        title: "AI Support Agent",
        desc: "Handles common support requests, automates FAQs, and absorbs part of the support load before human intervention.",
        result: "Reduce support workload and improve response time.",
        href: "/agent/support",
        link: "Open page →",
        accent: "#3B82F6",
        accentDim: "rgba(59,130,246,0.10)",
        accentBorder: "rgba(59,130,246,0.20)",
      },
    ],
    useCasesTitle: "Use cases",
    useCasesText:
      "These systems can be adapted to businesses that need fast replies, lead qualification, structured automation, or faster marketing content production.",
    useCases: [
      "Clinics and medical practices",
      "Dentists and opticians",
      "Agencies and consultants",
      "Training centers",
      "Beauty, spa, salons",
      "Real estate and local services",
      "E-commerce and DTC brands",
      "Creators and ad agencies",
    ],
    pricingTitle: "Pricing",
    pricingText:
      "A simple way to present your automations as real offers clients can understand and buy.",
    pricing: [
      {
        name: "Starter",
        price: "From €299",
        description: "One focused automation for one clear business need.",
        bullets: ["1 AI system", "1 main use case", "Basic setup"],
        featured: false,
      },
      {
        name: "Growth",
        price: "From €799",
        description: "More logic, more integrations, more business impact.",
        bullets: ["1 to 2 AI systems", "Business tool integrations", "Optimized for conversion / time savings"],
        featured: true,
      },
      {
        name: "Custom",
        price: "Custom quote",
        description: "Tailored architecture for more advanced workflows.",
        bullets: ["Multi-flow setup", "Business automation logic", "Support and evolution options"],
        featured: false,
      },
    ],
    bottomTitle: "Why this structure matters",
    bottomText:
      "Instead of showing one generic demo, you can send clients directly to the page that matches their need. That makes your offer clearer, more premium, and easier to sell.",
    featuredBadge: "Most popular",
    outcomeLabelFr: "Outcome:",
  },
};

// ─── Inline styles as constants ────────────────────────────────────────────
const S = {
  page: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "0 24px 80px",
    fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
  } as React.CSSProperties,

  // Lang toggle
  langWrap: {
    display: "flex",
    justifyContent: "flex-end",
    paddingTop: 20,
    marginBottom: 16,
  } as React.CSSProperties,
  langGroup: {
    display: "flex",
    gap: 4,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 999,
    padding: 3,
  } as React.CSSProperties,
  langBtnBase: {
    height: 30,
    width: 44,
    borderRadius: 999,
    border: "none",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', monospace",
    cursor: "pointer",
    letterSpacing: "0.04em",
    transition: "all 150ms ease",
  } as React.CSSProperties,

  // Hero
  hero: {
    paddingTop: 56,
    paddingBottom: 64,
    position: "relative",
  } as React.CSSProperties,
  heroBg: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(124,92,255,0.13) 0%, transparent 70%)",
    pointerEvents: "none",
  } as React.CSSProperties,
  heroBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "5px 12px 5px 8px",
    background: "rgba(124,92,255,0.12)",
    border: "1px solid rgba(124,92,255,0.24)",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 500,
    color: "#a594f9",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: "0.06em",
    marginBottom: 24,
    position: "relative",
  } as React.CSSProperties,
  heroBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#8B7CF6",
    boxShadow: "0 0 8px #8B7CF6",
  } as React.CSSProperties,
  heroTitle: {
    fontSize: "clamp(2rem, 4vw, 3.4rem)",
    fontWeight: 800,
    lineHeight: 1.08,
    letterSpacing: "-0.03em",
    color: "#f0f0ef",
    marginBottom: 20,
    maxWidth: 780,
    position: "relative",
  } as React.CSSProperties,
  heroSubtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.58)",
    lineHeight: 1.7,
    maxWidth: 620,
    marginBottom: 28,
    position: "relative",
  } as React.CSSProperties,
  proofWrap: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap" as const,
    marginBottom: 36,
    position: "relative",
  } as React.CSSProperties,
  proofPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "7px 14px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    fontWeight: 400,
  } as React.CSSProperties,
  proofDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "#8B7CF6",
    flexShrink: 0,
  } as React.CSSProperties,
  actionsRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap" as const,
    position: "relative",
  } as React.CSSProperties,
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "13px 24px",
    background: "#7C5CFF",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 999,
    textDecoration: "none",
    border: "none",
    transition: "opacity 150ms, transform 150ms",
    letterSpacing: "-0.01em",
  } as React.CSSProperties,
  btnSecondary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 22px",
    background: "transparent",
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: 500,
    borderRadius: 999,
    textDecoration: "none",
    border: "1px solid rgba(255,255,255,0.14)",
    transition: "border-color 150ms, background 150ms",
    letterSpacing: "-0.01em",
  } as React.CSSProperties,

  // Section titles
  sectionEyebrow: {
    display: "block",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.35)",
    marginBottom: 10,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: "clamp(1.4rem, 2.5vw, 2rem)",
    fontWeight: 700,
    color: "#f0f0ef",
    letterSpacing: "-0.025em",
    lineHeight: 1.2,
    marginBottom: 10,
  } as React.CSSProperties,
  sectionSubtitle: {
    fontSize: 15,
    color: "rgba(255,255,255,0.50)",
    lineHeight: 1.65,
    maxWidth: 560,
  } as React.CSSProperties,

  // Divider
  divider: {
    border: "none",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    margin: "56px 0",
  } as React.CSSProperties,
} as const;

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    const saved = localStorage.getItem(LANG_KEY) as Lang | null;
    if (saved === "fr" || saved === "en") setLang(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
  }, [lang]);

  const t = copy[lang];

  return (
    <NavbarFooter lang={lang} onLangChange={setLang}>
    <main style={S.page}>

      {/* ── Lang toggle ───────────────────────────────── */}
      <div style={S.langWrap}>
        <div style={S.langGroup}>
          {(["fr", "en"] as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              style={{
                ...S.langBtnBase,
                background: lang === l ? "rgba(255,255,255,0.10)" : "transparent",
                color: lang === l ? "#f0f0ef" : "rgba(255,255,255,0.38)",
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ── Hero ──────────────────────────────────────── */}
      <section style={S.hero}>
        <div style={S.heroBg} />

        <div style={S.heroBadge}>
          <span style={S.heroBadgeDot} />
          {t.badge}
        </div>

        <h1 style={S.heroTitle}>{t.title}</h1>
        <p style={S.heroSubtitle}>{t.subtitle}</p>

        <div style={S.proofWrap}>
          {t.proof.map((item) => (
            <span key={item} style={S.proofPill}>
              <span style={S.proofDot} />
              {item}
            </span>
          ))}
        </div>

        <div style={S.actionsRow}>
          <Link href="/agent/general" style={S.btnPrimary}>
            {t.primaryCta}
          </Link>
          <Link href="/agent/ugc-ads-engine" style={S.btnSecondary}>
            {t.secondaryCta}
          </Link>
        </div>
      </section>

      <hr style={S.divider} />

      {/* ── Agents grid ───────────────────────────────── */}
      <section>
        <div style={{ marginBottom: 36 }}>
          <span style={S.sectionEyebrow}>Agents</span>
          <h2 style={S.sectionTitle}>{t.agentsTitle}</h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          {t.agents.map((agent) => (
            <div
              key={agent.title}
              style={{
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 20,
                padding: "22px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 0,
                transition: "border-color 200ms",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = agent.accentBorder;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)";
              }}
            >
              {/* Label + accent dot */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: agent.accent,
                    boxShadow: `0 0 8px ${agent.accent}`,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: agent.accent,
                  }}
                >
                  {agent.label}
                </span>
              </div>

              {/* Title */}
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#f0f0ef",
                  lineHeight: 1.3,
                  letterSpacing: "-0.02em",
                  marginBottom: 10,
                }}
              >
                {agent.title}
              </h3>

              {/* Desc */}
              <p
                style={{
                  fontSize: 13.5,
                  color: "rgba(255,255,255,0.52)",
                  lineHeight: 1.6,
                  marginBottom: 16,
                  flexGrow: 1,
                }}
              >
                {agent.desc}
              </p>

              {/* Outcome pill */}
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: agent.accentDim,
                  border: `1px solid ${agent.accentBorder}`,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "rgba(255,255,255,0.80)",
                  marginBottom: 18,
                }}
              >
                <span style={{ color: agent.accent, fontWeight: 600, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>
                  {lang === "fr" ? "Résultat" : "Outcome"}
                </span>
                <br />
                {agent.result}
              </div>

              {/* CTA link */}
              <Link
                href={agent.href}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  color: agent.accent,
                  textDecoration: "none",
                  letterSpacing: "-0.01em",
                }}
              >
                {agent.link}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <hr style={S.divider} />

      {/* ── Use cases ─────────────────────────────────── */}
      <section>
        <div style={{ marginBottom: 28 }}>
          <span style={S.sectionEyebrow}>Use cases</span>
          <h2 style={S.sectionTitle}>{t.useCasesTitle}</h2>
          <p style={S.sectionSubtitle}>{t.useCasesText}</p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {t.useCases.map((item) => (
            <span
              key={item}
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.07)",
                background: "rgba(255,255,255,0.03)",
                color: "rgba(255,255,255,0.68)",
                fontSize: 13,
                fontWeight: 400,
                transition: "border-color 150ms, color 150ms",
              }}
            >
              {item}
            </span>
          ))}
        </div>
      </section>

      <hr style={S.divider} />

      {/* ── Pricing ───────────────────────────────────── */}
      <section id="pricing">
        <div style={{ marginBottom: 36 }}>
          <span style={S.sectionEyebrow}>Pricing</span>
          <h2 style={S.sectionTitle}>{t.pricingTitle}</h2>
          <p style={S.sectionSubtitle}>{t.pricingText}</p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
            alignItems: "start",
          }}
        >
          {t.pricing.map((plan) => (
            <div
              key={plan.name}
              style={{
                borderRadius: 20,
                padding: plan.featured ? "28px 24px" : "24px 20px",
                background: plan.featured
                  ? "rgba(124,92,255,0.10)"
                  : "rgba(255,255,255,0.025)",
                border: plan.featured
                  ? "1px solid rgba(124,92,255,0.32)"
                  : "1px solid rgba(255,255,255,0.07)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Featured glow */}
              {plan.featured && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 2,
                    background: "linear-gradient(90deg, transparent, #7C5CFF, transparent)",
                  }}
                />
              )}

              {/* Featured badge */}
              {plan.featured && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "3px 10px",
                    background: "rgba(124,92,255,0.20)",
                    border: "1px solid rgba(124,92,255,0.35)",
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#a594f9",
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    marginBottom: 14,
                  }}
                >
                  {lang === "fr" ? "Le plus populaire" : "Most popular"}
                </div>
              )}

              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.40)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontFamily: "'JetBrains Mono', monospace",
                  marginBottom: 8,
                }}
              >
                {plan.name}
              </div>

              <div
                style={{
                  fontSize: "1.9rem",
                  fontWeight: 800,
                  color: plan.featured ? "#c4b5fd" : "#f0f0ef",
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                  marginBottom: 10,
                }}
              >
                {plan.price}
              </div>

              <p
                style={{
                  fontSize: 13.5,
                  color: "rgba(255,255,255,0.55)",
                  lineHeight: 1.6,
                  marginBottom: 18,
                }}
              >
                {plan.description}
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {plan.bullets.map((bullet) => (
                  <div
                    key={bullet}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 9,
                      fontSize: 13.5,
                      color: "rgba(255,255,255,0.72)",
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: plan.featured
                          ? "rgba(124,92,255,0.22)"
                          : "rgba(255,255,255,0.06)",
                        border: plan.featured
                          ? "1px solid rgba(124,92,255,0.30)"
                          : "1px solid rgba(255,255,255,0.10)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: 2,
                        fontSize: 9,
                        color: plan.featured ? "#a594f9" : "rgba(255,255,255,0.4)",
                      }}
                    >
                      ✓
                    </span>
                    {bullet}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <hr style={S.divider} />

      {/* ── Bottom CTA ────────────────────────────────── */}
      <section
        style={{
          background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 20,
          padding: "36px 32px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 60% 80% at 100% 50%, rgba(124,92,255,0.07) 0%, transparent 60%)",
            pointerEvents: "none",
          }}
        />
        <h2
          style={{
            fontSize: "clamp(1.3rem, 2vw, 1.7rem)",
            fontWeight: 700,
            color: "#f0f0ef",
            letterSpacing: "-0.025em",
            marginBottom: 12,
            position: "relative",
          }}
        >
          {t.bottomTitle}
        </h2>
        <p
          style={{
            fontSize: 15,
            color: "rgba(255,255,255,0.52)",
            lineHeight: 1.7,
            maxWidth: 560,
            position: "relative",
          }}
        >
          {t.bottomText}
        </p>
      </section>

    </main>
    </NavbarFooter>
  );
}
