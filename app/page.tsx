"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import NavbarFooter from "./components/NavbarFooter";

type Lang = "fr" | "en";

const LANG_KEY = "boost_ai_landing_lang_v1";

const copy = {
  fr: {
    badge: "SaaS Multi-Agents",
    heroTitle: "Des agents IA qui font gagner du temps, capturent plus de leads et convertissent mieux.",
    heroLead: "Ton business tourne 24h/24. Ton équipe, non.",
    heroP1: ["Chaque message WhatsApp sans réponse, c'est un ", "lead perdu", ". Chaque support trop lent, c'est un ", "client frustré", ". Chaque heure passée sur des tâches répétitives, c'est une heure de moins pour faire croître ton business."],
    heroP2: "Le problème, ce n'est pas le manque d'effort — c'est l'échelle. Une personne ne peut pas être partout à la fois. Mais des agents IA, si.",
    heroP3: ["Nos agents ", "qualifient tes leads instantanément", ", gèrent tes demandes support avant qu'elles s'accumulent, et ", "produisent ton contenu marketing à la demande", ". Zéro burnout. Zéro délai. Zéro opportunité manquée — juste des résultats, en continu."],
    proof: ["Réponses instantanées 24/7", "Moins de charge manuelle", "Plus de leads traités sans recruter"],
    stats: [
      { num: "7", sup: "×", label: "Plus de chances de convertir quand le lead reçoit une réponse dans la première heure", sub: "Vitesse de réponse" },
      { num: "60", sup: "%", label: "Du temps d'équipe dépensé sur des tâches ne nécessitant pas de jugement humain", sub: "Potentiel d'automatisation" },
      { num: "24", sup: "/7", label: "Tes agents IA ne dorment jamais, ne ratent aucun message, ne s'épuisent pas", sub: "Toujours disponible" },
    ],
    agentsTitle: "Des systèmes conçus pour des résultats business",
    agents: [
      { label: "Agent 01", title: "Assistant Personnel IA", desc: "Centralise les demandes, exécute des actions, aide à traiter les tâches répétitives et fluidifie les opérations du quotidien.", result: "Gagne du temps et automatise les opérations à faible valeur.", href: "/agent/general", link: "Ouvrir la page →", accent: "#8B7CF6", dim: "rgba(139,124,246,0.12)", border: "rgba(139,124,246,0.22)" },
      { label: "Agent 02", title: "AI WhatsApp Lead Handling System", desc: "Répond instantanément aux leads WhatsApp, détecte l'intention, pousse à la réservation, transfère à un humain si nécessaire et gère les urgences.", result: "Capture plus de leads et augmente la conversion sans ralentir l'équipe.", href: "/agent/whatsapp-lead-system", link: "Ouvrir la page →", accent: "#25D366", dim: "rgba(37,211,102,0.10)", border: "rgba(37,211,102,0.20)" },
      { label: "Agent 03", title: "UGC Ads Engine", desc: "Transforme une simple idée ou image en vidéo UGC structurée avec script, hook, narration, direction vidéo, contrôle qualité et logique de fallback.", result: "Produit plus vite du contenu marketing prêt à publier et pensé pour convertir.", href: "/agent/ugc-ads-engine", link: "Ouvrir la page →", accent: "#F97316", dim: "rgba(249,115,22,0.10)", border: "rgba(249,115,22,0.20)" },
      { label: "Agent 04", title: "Agent Support IA", desc: "Gère les demandes fréquentes, automatise les FAQ et absorbe une partie du support avant intervention humaine.", result: "Réduit la charge support et améliore le temps de réponse client.", href: "/agent/support", link: "Ouvrir la page →", accent: "#3B82F6", dim: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.20)" },
      { label: "Agent 05", title: "AI Restaurant Call Assistant", desc: "Répond automatiquement aux appels du restaurant, prend des réservations, répond aux questions fréquentes, gère les escalades humaines et suit la performance par restaurant et par localisation.", result: "Réduit les appels manqués, améliore la prise en charge client et donne une visibilité claire sur les réservations, escalades et handoffs.", href: "/agent/restaurant-call-assistant", link: "Ouvrir la page →", accent: "#F59E0B", dim: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.22)" },
    ],
    useCasesTitle: "Cas d'usage",
    useCasesText: "Ces systèmes peuvent être adaptés à plusieurs activités qui ont besoin de répondre vite, qualifier des demandes, automatiser une partie du suivi ou produire du contenu marketing plus rapidement.",
    useCases: ["Cliniques et cabinets médicaux", "Dentistes et opticiens", "Agences et consultants", "Centres de formation", "Beauty, spa, salons", "Immobilier et services locaux", "E-commerce et marques DTC", "Créateurs et agences ads"],
    pricingTitle: "Offres",
    pricingText: "Une manière simple de présenter tes automatisations comme des offres concrètes et vendables.",
    pricing: [
      { name: "Starter", price: "À partir de 299€", description: "Une automatisation ciblée pour un besoin précis.", bullets: ["1 système IA", "1 cas d'usage principal", "Setup de base"], featured: false },
      { name: "Growth", price: "À partir de 799€", description: "Plus de logique, plus d'intégrations, plus d'impact business.", bullets: ["1 à 2 systèmes IA", "Connexions outils métier", "Optimisé pour conversion / gain de temps"], featured: true },
      { name: "Custom", price: "Sur devis", description: "Architecture sur mesure pour besoin plus avancé.", bullets: ["Multi-flows", "Automatisations métier", "Support et évolution possibles"], featured: false },
    ],
    bottomTitle: "Pourquoi cette structure est importante",
    bottomText: "Au lieu de montrer une simple démo générique, tu peux envoyer tes clients directement vers la page qui correspond à leur besoin. Ton offre devient plus claire, plus premium et plus facile à vendre.",
    outLabel: "Résultat",
  },
  en: {
    badge: "Multi-Agent SaaS",
    heroTitle: "AI agents that save time, capture more leads, and help businesses convert faster.",
    heroLead: "Your business runs 24/7. Your team doesn't.",
    heroP1: ["Every missed WhatsApp message is a ", "lost lead", ". Every slow support reply is a ", "frustrated client", ". Every hour spent on repetitive tasks is an hour not spent growing your business."],
    heroP2: "The problem isn't effort — it's scale. One person can't be everywhere at once. But AI agents can.",
    heroP3: ["Our agents ", "qualify your leads instantly", ", handle your support requests before they pile up, and ", "produce your marketing content on demand", ". No burnout. No delays. No missed opportunities — just results, around the clock."],
    proof: ["Instant replies 24/7", "Less manual workload", "More leads handled without hiring"],
    stats: [
      { num: "7", sup: "×", label: "More likely to convert when replied within the first hour", sub: "Lead response speed" },
      { num: "60", sup: "%", label: "Of team time spent on tasks that don't require human judgment", sub: "Automation potential" },
      { num: "24", sup: "/7", label: "Your AI agents never sleep, never miss a message, never burn out", sub: "Always on" },
    ],
    agentsTitle: "Systems designed for business outcomes",
    agents: [
      { label: "Agent 01", title: "AI Personal Assistant", desc: "Centralizes requests, executes actions, helps with repetitive tasks, and streamlines day-to-day operations.", result: "Save time and automate low-value operations.", href: "/agent/general", link: "Open page →", accent: "#8B7CF6", dim: "rgba(139,124,246,0.12)", border: "rgba(139,124,246,0.22)" },
      { label: "Agent 02", title: "AI WhatsApp Lead Handling System", desc: "Replies instantly to WhatsApp leads, detects intent, pushes booking, hands off to human staff when needed, and handles urgent cases.", result: "Capture more leads and improve conversion without slowing down your team.", href: "/agent/whatsapp-lead-system", link: "Open page →", accent: "#25D366", dim: "rgba(37,211,102,0.10)", border: "rgba(37,211,102,0.20)" },
      { label: "Agent 03", title: "UGC Ads Engine", desc: "Turns a simple idea or image into a structured UGC video with script, hook, narrative flow, video direction, quality control, and fallback logic.", result: "Produce ready-to-publish marketing content faster and with more consistency.", href: "/agent/ugc-ads-engine", link: "Open page →", accent: "#F97316", dim: "rgba(249,115,22,0.10)", border: "rgba(249,115,22,0.20)" },
      { label: "Agent 04", title: "AI Support Agent", desc: "Handles common support requests, automates FAQs, and absorbs part of the support load before human intervention.", result: "Reduce support workload and improve response time.", href: "/agent/support", link: "Open page →", accent: "#3B82F6", dim: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.20)" },
      { label: "Agent 05", title: "AI Restaurant Call Assistant", desc: "Handles restaurant calls automatically, takes bookings, answers frequent questions, manages human escalation, and tracks performance by restaurant and location.", result: "Reduces missed calls, improves customer handling, and gives clear visibility over bookings, escalations, and handoffs.", href: "/agent/restaurant-call-assistant", link: "Open page →", accent: "#F59E0B", dim: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.22)" },
    ],
    useCasesTitle: "Use cases",
    useCasesText: "These systems can be adapted to businesses that need fast replies, lead qualification, structured automation, or faster marketing content production.",
    useCases: ["Clinics and medical practices", "Dentists and opticians", "Agencies and consultants", "Training centers", "Beauty, spa, salons", "Real estate and local services", "E-commerce and DTC brands", "Creators and ad agencies"],
    pricingTitle: "Pricing",
    pricingText: "A simple way to present your automations as real offers clients can understand and buy.",
    pricing: [
      { name: "Starter", price: "From €299", description: "One focused automation for one clear business need.", bullets: ["1 AI system", "1 main use case", "Basic setup"], featured: false },
      { name: "Growth", price: "From €799", description: "More logic, more integrations, more business impact.", bullets: ["1 to 2 AI systems", "Business tool integrations", "Optimized for conversion / time savings"], featured: true },
      { name: "Custom", price: "Custom quote", description: "Tailored architecture for more advanced workflows.", bullets: ["Multi-flow setup", "Business automation logic", "Support and evolution options"], featured: false },
    ],
    bottomTitle: "Why this structure matters",
    bottomText: "Instead of showing one generic demo, you can send clients directly to the page that matches their need. That makes your offer clearer, more premium, and easier to sell.",
    outLabel: "Outcome",
  },
};

const S = {
  page: { maxWidth: 1100, margin: "0 auto", padding: "0 clamp(16px, 3vw, 24px) 80px", fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif" } as React.CSSProperties,
  hero: { paddingTop: "clamp(40px, 7vw, 56px)", paddingBottom: 0, position: "relative" } as React.CSSProperties,
  heroBg: { position: "absolute", inset: 0, background: "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(124,92,255,0.13), transparent 70%)", pointerEvents: "none" } as React.CSSProperties,
  heroBadge: { display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 13px 5px 8px", background: "rgba(124,92,255,0.12)", border: "1px solid rgba(124,92,255,0.24)", borderRadius: 999, fontSize: 11, fontWeight: 500, color: "#a594f9", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em", marginBottom: 24, position: "relative" } as React.CSSProperties,
  badgeDot: { width: 6, height: 6, borderRadius: "50%", background: "#8B7CF6", boxShadow: "0 0 8px #8B7CF6" } as React.CSSProperties,
  heroTitle: { fontFamily: "'Syne', sans-serif", fontSize: "clamp(2rem, 4vw, 3.2rem)", fontWeight: 800, lineHeight: 1.06, letterSpacing: "-0.035em", color: "#f0f0ef", marginBottom: 28, maxWidth: 780, position: "relative" } as React.CSSProperties,
  heroBody: { maxWidth: 660, display: "flex", flexDirection: "column", gap: 14, marginBottom: 28, position: "relative" } as React.CSSProperties,
  heroLead: { fontSize: "clamp(15px, 2.8vw, 17px)", fontWeight: 500, color: "#f0f0ef", lineHeight: 1.55, letterSpacing: "-0.01em" } as React.CSSProperties,
  heroP: { fontSize: "clamp(14px, 2.4vw, 15px)", color: "rgba(255,255,255,0.52)", lineHeight: 1.78, fontWeight: 300 } as React.CSSProperties,
  heroStrong: { color: "rgba(255,255,255,0.82)", fontWeight: 500 } as React.CSSProperties,
  proofWrap: { display: "flex", gap: 8, flexWrap: "wrap" as const, marginBottom: 44, position: "relative" } as React.CSSProperties,
  proofPill: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.70)", fontSize: 13 } as React.CSSProperties,
  proofDot: { width: 5, height: 5, borderRadius: "50%", background: "#8B7CF6", flexShrink: 0 } as React.CSSProperties,
  statBanner: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, overflow: "hidden", marginBottom: 64 } as React.CSSProperties,
  statItem: { padding: "24px 26px", display: "flex", flexDirection: "column" as const, gap: 5, borderRight: "1px solid rgba(255,255,255,0.07)" } as React.CSSProperties,
  statItemLast: { padding: "24px 26px", display: "flex", flexDirection: "column" as const, gap: 5 } as React.CSSProperties,
  statNum: { fontFamily: "'Syne', sans-serif", fontSize: "2.2rem", fontWeight: 800, letterSpacing: "-0.04em", color: "#f0f0ef", lineHeight: 1 } as React.CSSProperties,
  statSup: { fontSize: "1.3rem", color: "#8B7CF6" } as React.CSSProperties,
  statLabel: { fontSize: 13, color: "rgba(255,255,255,0.48)", lineHeight: 1.55 } as React.CSSProperties,
  statSub: { fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.22)", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginTop: 4 } as React.CSSProperties,
  divider: { border: "none", borderTop: "1px solid rgba(255,255,255,0.06)", margin: "0 0 56px" } as React.CSSProperties,
  eyebrow: { display: "block", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.30)", marginBottom: 10 } as React.CSSProperties,
  sectionTitle: { fontSize: "clamp(1.4rem, 2.5vw, 2rem)", fontWeight: 700, color: "#f0f0ef", letterSpacing: "-0.025em", lineHeight: 1.2, marginBottom: 10, fontFamily: "'Syne', sans-serif" } as React.CSSProperties,
  sectionSubtitle: { fontSize: 15, color: "rgba(255,255,255,0.50)", lineHeight: 1.65, maxWidth: 560 } as React.CSSProperties,
  dividerSection: { border: "none", borderTop: "1px solid rgba(255,255,255,0.06)", margin: "56px 0" } as React.CSSProperties,
};

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
    <main className="landing-main" style={S.page}>

      {/* ── HERO ── */}
      <section className="landing-hero" style={S.hero}>
        <div style={S.heroBg} />

        <div style={S.heroBadge}>
          <span style={S.badgeDot} />
          {t.badge}
        </div>

        <h1 className="landing-hero-title" style={S.heroTitle}>{t.heroTitle}</h1>

        <div style={S.heroBody}>
          <p className="landing-hero-lead" style={S.heroLead}>{t.heroLead}</p>
          <p className="landing-hero-copy" style={S.heroP}>
            {t.heroP1[0]}<strong style={S.heroStrong}>{t.heroP1[1]}</strong>{t.heroP1[2]}<strong style={S.heroStrong}>{t.heroP1[3]}</strong>{t.heroP1[4]}
          </p>
          <p className="landing-hero-copy" style={S.heroP}>{t.heroP2}</p>
          <p className="landing-hero-copy" style={S.heroP}>
            {t.heroP3[0]}<strong style={S.heroStrong}>{t.heroP3[1]}</strong>{t.heroP3[2]}<strong style={S.heroStrong}>{t.heroP3[3]}</strong>{t.heroP3[4]}
          </p>
        </div>

        {/* Proof pills */}
        <div style={S.proofWrap}>
          {t.proof.map((item) => (
            <span key={item} style={S.proofPill}>
              <span style={S.proofDot} />
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* ── STAT BANNER ── */}
      <div className="landing-stat-banner" style={S.statBanner}>
        {t.stats.map((stat, i) => (
          <div
            key={stat.sub}
            className={i === t.stats.length - 1 ? "landing-stat-item-last" : "landing-stat-item"}
            style={i === t.stats.length - 1 ? S.statItemLast : S.statItem}
          >
            <div style={S.statNum}>
              {stat.num}<span style={S.statSup}>{stat.sup}</span>
            </div>
            <div style={S.statLabel}>{stat.label}</div>
            <div style={S.statSub}>{stat.sub}</div>
          </div>
        ))}
      </div>

      <hr style={S.divider} />

      {/* ── AGENTS ── */}
      <section>
        <div className="landing-section-intro" style={{ marginBottom: 36 }}>
          <span style={S.eyebrow}>Agents</span>
          <h2 style={S.sectionTitle}>{t.agentsTitle}</h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          {t.agents.map((agent) => (
            <div
              className="landing-card"
              key={agent.title}
              style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: "22px 20px", display: "flex", flexDirection: "column", transition: "border-color 200ms" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = agent.border; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: agent.accent, boxShadow: `0 0 8px ${agent.accent}`, flexShrink: 0 }} />
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: agent.accent }}>{agent.label}</span>
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#f0f0ef", lineHeight: 1.3, letterSpacing: "-0.02em", marginBottom: 10, fontFamily: "'Syne', sans-serif" }}>{agent.title}</h3>
              <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.52)", lineHeight: 1.6, marginBottom: 16, flexGrow: 1 }}>{agent.desc}</p>
              <div style={{ padding: "10px 14px", borderRadius: 12, background: agent.dim, border: `1px solid ${agent.border}`, fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,0.80)", marginBottom: 18 }}>
                <span style={{ color: agent.accent, fontWeight: 600, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>{t.outLabel}</span>
                <br />{agent.result}
              </div>
              <Link
                href={agent.href}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  width: "100%",
                  minHeight: 46,
                  padding: "11px 14px",
                  borderRadius: 999,
                  border: `1px solid ${agent.border}`,
                  background: agent.dim,
                  color: agent.accent,
                  textDecoration: "none",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  boxShadow: `0 10px 24px ${agent.dim}`,
                  transition: "transform 180ms ease, border-color 180ms ease, background 180ms ease, box-shadow 180ms ease",
                }}
                onMouseEnter={(e) => {
                  const element = e.currentTarget as HTMLElement;
                  element.style.transform = "translateY(-1px)";
                  element.style.borderColor = agent.accent;
                  element.style.background = agent.border;
                  element.style.boxShadow = `0 14px 30px ${agent.dim}`;
                  const arrow = element.lastElementChild as HTMLElement | null;
                  if (arrow) {
                    arrow.style.transform = "translateX(2px)";
                    arrow.style.background = "rgba(255,255,255,0.16)";
                  }
                }}
                onMouseLeave={(e) => {
                  const element = e.currentTarget as HTMLElement;
                  element.style.transform = "translateY(0)";
                  element.style.borderColor = agent.border;
                  element.style.background = agent.dim;
                  element.style.boxShadow = `0 10px 24px ${agent.dim}`;
                  const arrow = element.lastElementChild as HTMLElement | null;
                  if (arrow) {
                    arrow.style.transform = "translateX(0)";
                    arrow.style.background = "rgba(255,255,255,0.08)";
                  }
                }}
              >
                <span>{agent.link}</span>
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.08)",
                    color: agent.accent,
                    fontSize: 14,
                    flexShrink: 0,
                    transition: "transform 180ms ease, background 180ms ease",
                  }}
                >
                  →
                </span>
              </Link>
            </div>
          ))}
        </div>
      </section>

      <hr style={S.dividerSection} />

      {/* ── USE CASES ── */}
      <section>
        <div style={{ marginBottom: 28 }}>
          <span style={S.eyebrow}>Use cases</span>
          <h2 style={S.sectionTitle}>{t.useCasesTitle}</h2>
          <p style={S.sectionSubtitle}>{t.useCasesText}</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {t.useCases.map((item) => (
            <span key={item} style={{ padding: "8px 16px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.68)", fontSize: 13 }}>
              {item}
            </span>
          ))}
        </div>
      </section>

      <hr style={S.dividerSection} />

      {/* ── PRICING ── */}
      <section id="pricing">
        <div className="landing-section-intro" style={{ marginBottom: 36 }}>
          <span style={S.eyebrow}>Pricing</span>
          <h2 style={S.sectionTitle}>{t.pricingTitle}</h2>
          <p style={S.sectionSubtitle}>{t.pricingText}</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, alignItems: "start" }}>
          {t.pricing.map((plan) => (
            <div className="landing-pricing-card" key={plan.name} style={{ borderRadius: 20, padding: plan.featured ? "28px 24px" : "24px 20px", background: plan.featured ? "rgba(124,92,255,0.10)" : "rgba(255,255,255,0.025)", border: plan.featured ? "1px solid rgba(124,92,255,0.32)" : "1px solid rgba(255,255,255,0.07)", position: "relative", overflow: "hidden" }}>
              {plan.featured && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, #7C5CFF, transparent)" }} />}
              {plan.featured && (
                <div style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", background: "rgba(124,92,255,0.20)", border: "1px solid rgba(124,92,255,0.35)", borderRadius: 999, fontSize: 10, fontWeight: 600, color: "#a594f9", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 }}>
                  {lang === "fr" ? "Le plus populaire" : "Most popular"}
                </div>
              )}
              <div style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.40)", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>{plan.name}</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "1.9rem", fontWeight: 800, color: plan.featured ? "#c4b5fd" : "#f0f0ef", letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 10 }}>{plan.price}</div>
              <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.6, marginBottom: 18 }}>{plan.description}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {plan.bullets.map((bullet) => (
                  <div key={bullet} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13.5, color: "rgba(255,255,255,0.72)" }}>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", background: plan.featured ? "rgba(124,92,255,0.22)" : "rgba(255,255,255,0.06)", border: plan.featured ? "1px solid rgba(124,92,255,0.30)" : "1px solid rgba(255,255,255,0.10)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2, fontSize: 9, color: plan.featured ? "#a594f9" : "rgba(255,255,255,0.4)" }}>✓</span>
                    {bullet}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <hr style={S.dividerSection} />

      {/* ── BOTTOM ── */}
      <section style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: "36px 32px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 60% 80% at 100% 50%, rgba(124,92,255,0.07) 0%, transparent 60%)", pointerEvents: "none" }} />
        <h2 style={{ fontSize: "clamp(1.3rem, 2vw, 1.7rem)", fontWeight: 700, color: "#f0f0ef", letterSpacing: "-0.025em", marginBottom: 12, position: "relative", fontFamily: "'Syne', sans-serif" }}>{t.bottomTitle}</h2>
        <p className="landing-bottom-copy" style={{ fontSize: 15, color: "rgba(255,255,255,0.52)", lineHeight: 1.7, maxWidth: 560, position: "relative" }}>{t.bottomText}</p>
      </section>

    </main>
    </NavbarFooter>
  );
}
