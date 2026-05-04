"use client";

import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { useEffect, useState } from "react";
import NavbarFooter from "./components/NavbarFooter";

type Lang = "fr" | "en";

const LANG_KEY = "boost_ai_landing_lang_v1";

const copy = {
  fr: {
    badge: "SaaS Multi-Agents",
    heroTitle: "Des agents IA pour répondre plus vite, automatiser mieux et convertir plus.",
    heroLead: "Ton business tourne 24h/24. Ton équipe, non.",
    heroP1: ["Chaque message sans réponse est une ", "opportunité perdue", ". Chaque tâche répétitive ralentit la ", "croissance", "."],
    heroP2: "Boost My Businesses construit des systèmes IA qui répondent, qualifient, automatisent et transmettent les bons sujets à ton équipe.",
    heroP3: ["Moins de charge manuelle, ", "plus de suivi instantané", ", et des opérations qui restent fluides ", "même quand ton équipe est occupée", "."],
    proof: ["Réponses instantanées 24/7", "Moins de charge manuelle", "Plus de leads traités sans recruter"],
    stats: [
      { num: "7", sup: "×", label: "Plus de chances de convertir quand le lead reçoit une réponse dans la première heure", sub: "Vitesse de réponse" },
      { num: "60", sup: "%", label: "Du temps d'équipe dépensé sur des tâches ne nécessitant pas de jugement humain", sub: "Potentiel d'automatisation" },
      { num: "24", sup: "/7", label: "Tes agents IA ne dorment jamais, ne ratent aucun message, ne s'épuisent pas", sub: "Toujours disponible" },
    ],
    agentsTitle: "Des systèmes IA prêts pour tes opérations",
    agents: [
      { label: "Agent 01", title: "Assistant Personnel IA", desc: "Centralise les demandes et automatise les tâches récurrentes du quotidien.", result: "Gagne du temps sur les opérations à faible valeur.", href: "/agent/general", link: "Ouvrir la page →", accent: "#8B7CF6", dim: "rgba(139,124,246,0.12)", border: "rgba(139,124,246,0.22)" },
      { label: "Agent 02", title: "AI WhatsApp Lead Handling System", desc: "Répond aux leads WhatsApp, détecte l'intention et déclenche le bon suivi.", result: "Capture plus de leads sans ralentir l'équipe.", href: "/agent/whatsapp-lead-system", link: "Ouvrir la page →", accent: "#25D366", dim: "rgba(37,211,102,0.10)", border: "rgba(37,211,102,0.20)" },
      { label: "Agent 03", title: "UGC Ads Engine", desc: "Transforme une idée ou image en vidéo UGC structurée et prête à produire.", result: "Crée plus vite du contenu pensé pour convertir.", href: "/agent/ugc-ads-engine", link: "Ouvrir la page →", accent: "#F97316", dim: "rgba(249,115,22,0.10)", border: "rgba(249,115,22,0.20)" },
      { label: "Agent 04", title: "Agent Support IA", desc: "Absorbe les demandes fréquentes et prépare les escalades utiles.", result: "Réduit la charge support et accélère les réponses.", href: "/agent/support", link: "Ouvrir la page →", accent: "#3B82F6", dim: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.20)" },
      { label: "Agent 05", title: "AI Restaurant Call Assistant", desc: "Répond aux appels, capture les réservations et suit les escalades.", result: "Récupère les appels manqués et améliore la prise en charge.", href: "/agent/restaurant-call-assistant", link: "Ouvrir la page →", accent: "#F59E0B", dim: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.22)" },
    ],
    useCasesTitle: "Cas d'usage",
    useCasesText: "Pour les équipes qui doivent répondre vite, qualifier mieux et automatiser sans complexité.",
    useCases: ["Restaurants", "Agences et consultants", "Santé et services", "E-commerce", "Formation", "Créateurs et ads"],
    trustBadge: "Systèmes testés en conditions réelles",
    trustTitle: "Ils nous font confiance pour gérer leurs opérations",
    trustText: "De la restauration au conseil en passant par les ONG, nos systèmes IA et automatisations sont déjà utilisés dans des environnements exigeants.",
    testimonials: [
      { company: "In de Patattezak bij Pee Klak", category: "Restaurant", logo: "/logos/patattezak.png", initials: "IP", quote: "Nous avons utilisé le système pour mieux gérer les demandes pendant les périodes de rush. Cela réduit les opportunités perdues et fluidifie le service." },
      { company: "DMT Consulting", category: "Conseil en ingénierie", description: "Fournisseur reconnu de solutions d'ingénierie innovantes et durables.", logo: "/logos/dmt-consulting.png", initials: "DMT", quote: "Nous avons déployé plusieurs automatisations avec Boost My Businesses. L'architecture est fiable, flexible et pensée pour un usage réel." },
      { company: "Save Animals", category: "ONG de protection animale", logo: "/logos/save-animals.png", initials: "SA", quote: "Nous avons adapté une version personnalisée du système à nos besoins. Cela nous a permis de gérer les demandes plus efficacement sans alourdir la charge de travail." },
    ],
    calendlyTitle: "Réserve une démo en 30 secondes",
    calendlyText: "Découvre comment l'automatisation IA peut faire gagner du temps et récupérer des opportunités perdues.",
    pricingTitle: "Offres",
    pricingText: "Une manière simple de présenter tes automatisations comme des offres concrètes et vendables.",
    pricing: [
      { name: "Starter", price: "À partir de 299€", description: "Une automatisation ciblée pour un besoin précis.", bullets: ["1 système IA", "1 cas d'usage principal", "Setup de base"], featured: false },
      { name: "Growth", price: "À partir de 799€", description: "Plus de logique, plus d'intégrations, plus d'impact business.", bullets: ["1 à 2 systèmes IA", "Connexions outils métier", "Optimisé pour conversion / gain de temps"], featured: true },
      { name: "Custom", price: "Sur devis", description: "Architecture sur mesure pour besoin plus avancé.", bullets: ["Multi-flows", "Automatisations métier", "Support et évolution possibles"], featured: false },
    ],
    bottomTitle: "Prêt à automatiser un vrai workflow ?",
    bottomText: "Choisis le système qui correspond à ton besoin ou réserve une démo pour identifier l'automatisation la plus rentable.",
    outLabel: "Résultat",
  },
  en: {
    badge: "Multi-Agent SaaS",
    heroTitle: "AI agents that reply faster, automate better, and help businesses convert.",
    heroLead: "Your business runs 24/7. Your team doesn't.",
    heroP1: ["Every unanswered message is a ", "missed opportunity", ". Every repetitive task slows down ", "growth", "."],
    heroP2: "Boost My Businesses builds AI systems that reply, qualify, automate, and hand off the right work to your team.",
    heroP3: ["Less manual work, ", "more instant follow-up", ", and operations that stay smooth ", "even when your team is busy", "."],
    proof: ["Instant replies 24/7", "Less manual workload", "More leads handled without hiring"],
    stats: [
      { num: "7", sup: "×", label: "More likely to convert when replied within the first hour", sub: "Lead response speed" },
      { num: "60", sup: "%", label: "Of team time spent on tasks that don't require human judgment", sub: "Automation potential" },
      { num: "24", sup: "/7", label: "Your AI agents never sleep, never miss a message, never burn out", sub: "Always on" },
    ],
    agentsTitle: "AI systems ready for real operations",
    agents: [
      { label: "Agent 01", title: "AI Personal Assistant", desc: "Centralizes requests and automates recurring daily tasks.", result: "Save time on low-value operations.", href: "/agent/general", link: "Open page →", accent: "#8B7CF6", dim: "rgba(139,124,246,0.12)", border: "rgba(139,124,246,0.22)" },
      { label: "Agent 02", title: "AI WhatsApp Lead Handling System", desc: "Replies to WhatsApp leads, detects intent, and triggers the right follow-up.", result: "Capture more leads without slowing the team.", href: "/agent/whatsapp-lead-system", link: "Open page →", accent: "#25D366", dim: "rgba(37,211,102,0.10)", border: "rgba(37,211,102,0.20)" },
      { label: "Agent 03", title: "UGC Ads Engine", desc: "Turns an idea or image into a structured UGC video ready for production.", result: "Create conversion-focused content faster.", href: "/agent/ugc-ads-engine", link: "Open page →", accent: "#F97316", dim: "rgba(249,115,22,0.10)", border: "rgba(249,115,22,0.20)" },
      { label: "Agent 04", title: "AI Support Agent", desc: "Handles frequent requests and prepares useful human escalations.", result: "Reduce support load and speed up replies.", href: "/agent/support", link: "Open page →", accent: "#3B82F6", dim: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.20)" },
      { label: "Agent 05", title: "AI Restaurant Call Assistant", desc: "Answers calls, captures bookings, and tracks escalations.", result: "Recover missed calls and improve customer handling.", href: "/agent/restaurant-call-assistant", link: "Open page →", accent: "#F59E0B", dim: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.22)" },
    ],
    useCasesTitle: "Use cases",
    useCasesText: "For teams that need faster replies, better qualification, and automation without complexity.",
    useCases: ["Restaurants", "Agencies and consultants", "Health and services", "E-commerce", "Training", "Creators and ads"],
    trustBadge: "Production-tested systems",
    trustTitle: "They trust us to handle their operations",
    trustText: "From restaurants to consulting and non-profits, our AI and automation systems are already used in demanding environments.",
    testimonials: [
      { company: "In de Patattezak bij Pee Klak", category: "Restaurant", logo: "/logos/patattezak.png", initials: "IP", quote: "We used the system to better handle incoming requests during busy periods. It helps reduce missed opportunities and keeps operations smooth." },
      { company: "DMT Consulting", category: "Engineering consulting", description: "Trusted provider of innovative and sustainable engineering solutions.", logo: "/logos/dmt-consulting.png", initials: "DMT", quote: "We've implemented several automation systems from Boost My Businesses. The architecture is reliable, flexible, and built for real-world usage." },
      { company: "Save Animals", category: "Animal protection NGO", logo: "/logos/save-animals.png", initials: "SA", quote: "We adapted a custom version of the automation system to fit our needs. It helped us manage requests more efficiently without increasing workload." },
    ],
    calendlyTitle: "Book a demo in 30 seconds",
    calendlyText: "See how AI automation can save time and recover missed opportunities.",
    pricingTitle: "Pricing",
    pricingText: "A simple way to present your automations as real offers clients can understand and buy.",
    pricing: [
      { name: "Starter", price: "From €299", description: "One focused automation for one clear business need.", bullets: ["1 AI system", "1 main use case", "Basic setup"], featured: false },
      { name: "Growth", price: "From €799", description: "More logic, more integrations, more business impact.", bullets: ["1 to 2 AI systems", "Business tool integrations", "Optimized for conversion / time savings"], featured: true },
      { name: "Custom", price: "Custom quote", description: "Tailored architecture for more advanced workflows.", bullets: ["Multi-flow setup", "Business automation logic", "Support and evolution options"], featured: false },
    ],
    bottomTitle: "Ready to automate a real workflow?",
    bottomText: "Choose the system that matches your need or book a demo to identify the highest-value automation.",
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

function TestimonialLogo({
  src,
  alt,
  initials,
}: {
  src: string;
  alt: string;
  initials: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div
        aria-label={alt}
        style={{
          width: 88,
          height: 72,
          borderRadius: 16,
          border: "1px solid rgba(124,92,255,0.26)",
          background: "rgba(124,92,255,0.12)",
          color: "#c4b5fd",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Syne', sans-serif",
          fontSize: 17,
          fontWeight: 800,
        }}
      >
        {initials}
      </div>
    );
  }

  return (
    <div
      style={{
        width: 104,
        height: 76,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 10,
        overflow: "hidden",
      }}
    >
      <Image
        src={src}
        alt={alt}
        width={150}
        height={80}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
        onError={() => setHasError(true)}
      />
    </div>
  );
}

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    const saved = window.localStorage.getItem(LANG_KEY) as Lang | null;
    return saved === "fr" || saved === "en" ? saved : "en";
  });

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

      {/* ── SOCIAL PROOF ── */}
      <section>
        <div className="landing-section-intro" style={{ marginBottom: 32 }}>
          <span style={S.eyebrow}>{t.trustBadge}</span>
          <h2 style={S.sectionTitle}>{t.trustTitle}</h2>
          <p style={S.sectionSubtitle}>{t.trustText}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16, alignItems: "stretch" }}>
          {t.testimonials.map((item) => (
            <article
              key={item.company}
              className="landing-card"
              style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.026) 100%)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: "18px", minHeight: 256, display: "flex", flexDirection: "column", justifyContent: "space-between", transition: "border-color 200ms, transform 200ms" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(124,92,255,0.28)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
            >
              <div>
                <TestimonialLogo src={item.logo} alt={`${item.company} logo`} initials={item.initials} />
                <div style={{ marginTop: 12 }}>
                  <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 17, fontWeight: 800, color: "#f0f0ef", lineHeight: 1.2, marginBottom: 5 }}>
                    {item.company}
                  </h3>
                  <p style={{ color: "#a594f9", fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", lineHeight: 1.35 }}>
                    {item.category}
                  </p>
                  {"description" in item && item.description && (
                    <p style={{ color: "rgba(255,255,255,0.46)", fontSize: 12.5, lineHeight: 1.42, marginTop: 7 }}>
                      {item.description}
                    </p>
                  )}
                </div>
              </div>

              <blockquote style={{ margin: "16px 0 0", color: "rgba(255,255,255,0.72)", fontSize: 14.5, lineHeight: 1.52 }}>
                &ldquo;{item.quote}&rdquo;
              </blockquote>
            </article>
          ))}
        </div>
      </section>

      <hr style={S.dividerSection} />

      {/* ── CALENDLY ── */}
      <section id="book-demo">
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ textAlign: "center", margin: "0 auto 28px", maxWidth: 680 }}>
            <h2 style={S.sectionTitle}>{t.calendlyTitle}</h2>
            <p style={{ ...S.sectionSubtitle, margin: "0 auto" }}>{t.calendlyText}</p>
          </div>

          <div style={{ border: "1px solid rgba(124,92,255,0.24)", background: "linear-gradient(135deg, rgba(124,92,255,0.08) 0%, rgba(255,255,255,0.025) 48%, rgba(8,18,38,0.72) 100%)", borderRadius: 24, padding: "clamp(10px, 2vw, 16px)", boxShadow: "0 26px 80px rgba(0,0,0,0.24)", overflow: "hidden" }}>
            <Script
              src="https://assets.calendly.com/assets/external/widget.js"
              strategy="lazyOnload"
            />
            <div
              className="calendly-inline-widget homepage-calendly-frame"
              data-url="https://calendly.com/boostmybusinesses/discovertheassistant"
              style={{ minWidth: "320px", height: "700px" }}
            />
          </div>
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
