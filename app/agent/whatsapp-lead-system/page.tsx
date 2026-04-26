"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import NavbarFooter from "../../components/NavbarFooter";

type Lang = "fr" | "en";

const LANG_KEY = "whatsapp_ai_system_lang_v1";

// ── Accent colors (WhatsApp identity) ──────────────────────
const AC = "#25D366";
const AC_DIM = "rgba(37,211,102,0.10)";
const AC_BORDER = "rgba(37,211,102,0.22)";
const AC_TEXT = "#25D366";

const copy = {
  fr: {
    badge: "Automatisation WhatsApp IA",
    heroTitle:
      "Des leads WhatsApp gérés automatiquement, qualifiés instantanément et transférés au bon moment.",
    heroSubtitle:
      "Ce système IA répond aux prospects 24h/24, détecte l'intention, pousse à la réservation et escalade les cas urgents vers ton équipe via Slack.",
    primaryCta: "Ouvrir la démo visuelle",
    secondaryCta: "Retour à l'accueil",
    stats: [
      { label: "Disponibilité", value: "24/7" },
      { label: "Actions clés", value: "FAQ • Booking • Urgence" },
      { label: "Escalade", value: "Slack handoff" },
    ],
    productBoxTitle: "Ce que fait le système",
    productSteps: [
      { label: "Message entrant", text: "\u201cJe veux prendre rendez-vous\u201d" },
      { label: "Détection IA", text: "L\u2019intention de réservation est détectée instantanément" },
      { label: "Réponse automatique", text: "Le lien de réservation est envoyé automatiquement" },
      { label: "Fallback urgence", text: "Les cas critiques déclenchent une alerte Slack pour l\u2019équipe" },
    ],
    problemTitle: "Le problème que ce système résout",
    problemText: "Beaucoup d\u2019entreprises perdent des leads sur WhatsApp parce que les réponses arrivent trop tard, que l\u2019équipe est débordée et qu\u2019aucun suivi structuré n\u2019existe.",
    problems: ["Réponses trop lentes", "Équipe surchargée", "Pas de suivi structuré"],
    solutionTitle: "La solution",
    solutionText: "Ce workflow automatise l\u2019ensemble du parcours lead, du premier message jusqu\u2019à l\u2019escalade humaine si nécessaire.",
    solutions: [
      "Réponses IA instantanées (24/7)",
      "Détection intelligente d\u2019intention (inquiry, booking, urgent)",
      "Suggestions automatiques de rendez-vous",
      "Escalade humaine pour les cas critiques",
      "Alertes Slack pour la visibilité équipe",
    ],
    featuresTitle: "Fonctionnalités",
    featuresText: "Ce n\u2019est pas juste un chatbot. C\u2019est un système de gestion de leads structuré et prêt à être adapté à de vrais besoins business.",
    features: [
      "Intégration WhatsApp (Meta API)",
      "Agent conversationnel IA",
      "Classification d\u2019intention (GPT-based)",
      "Détection d\u2019urgence & escalade",
      "Système de notifications Slack",
      "Structure prête pour CRM",
      "Intégration lien de réservation (Calendly)",
      "Architecture prête pour mémoire",
    ],
    demoTitle: "Démo visuelle",
    demoText: "Clique sur une capture pour l\u2019ouvrir en grand et mieux visualiser le workflow, les alertes et l\u2019expérience utilisateur.",
    workflowTitle: "Comment le système fonctionne",
    workflowText: "Pour le prospect, l\u2019expérience est simple. En coulisses, le système route, qualifie et escalade selon des règles concrètes.",
    flowSteps: [
      "Le prospect envoie un message sur WhatsApp",
      "L\u2019IA détecte l\u2019intention (inquiry / booking / urgent)",
      "L\u2019IA répond instantanément",
      "Si nécessaire \u2192 escalade vers un humain",
      "L\u2019équipe reçoit une alerte via Slack",
      "Le lead reçoit une confirmation claire",
    ],
    stackTitle: "Stack technique",
    stackText: "Le système s\u2019appuie sur des outils crédibles et prêts pour la production.",
    stack: ["n8n (workflow automation)", "OpenAI (AI agent)", "WhatsApp Cloud API", "Slack API", "Calendly", "Airtable / Notion / autre CRM"],
    impactTitle: "Résultat business",
    impactText: "La valeur n\u2019est pas seulement technique. Elle améliore directement la vitesse, la charge de travail et la conversion.",
    businessResults: [
      "Temps de réponse plus rapide (instantané vs heures)",
      "Meilleure conversion des leads",
      "Moins de charge pour l\u2019équipe",
      "Meilleure gestion des cas urgents",
    ],
    useCasesTitle: "Autres domaines où ce système marche",
    useCasesText: "Ce flow peut être adapté à d\u2019autres activités qui dépendent de la messagerie, des rendez-vous ou de la qualification rapide.",
    useCases: {
      "Santé & Médical": ["Cliniques", "Dentistes", "Physiothérapeutes", "Opticiens", "Dermatologues", "Médecins privés"],
      "Services": ["Salons de beauté", "Coiffeurs", "Spas", "Centres de massage", "Tattoo studios"],
      "Business locaux": ["Garages", "Services de nettoyage", "Agences immobilières", "Courtiers en assurance"],
      "Services high-ticket": ["Coachs", "Consultants", "Agences", "Freelancers"],
      "Éducation": ["Centres de formation", "Cours en ligne", "Tuteurs"],
    },
    ctaEyebrow: "Démo live",
    ctaTitle: "Tu veux ce système pour ton business ?",
    ctaText: "Teste la logique du système ou contacte directement le numéro business utilisé pour la démonstration.",
    ctaDemo: "Ouvrir la démo visuelle",
    ctaWhatsApp: "Tester en live sur WhatsApp",
  },
  en: {
    badge: "AI WhatsApp Automation",
    heroTitle: "WhatsApp leads handled automatically, qualified instantly, and escalated at the right moment.",
    heroSubtitle: "This AI system replies to prospects 24/7, detects intent, pushes booking, and escalates urgent cases to your team via Slack.",
    primaryCta: "Open visual demo",
    secondaryCta: "Back to homepage",
    stats: [
      { label: "Availability", value: "24/7" },
      { label: "Core actions", value: "FAQ \u2022 Booking \u2022 Urgent" },
      { label: "Escalation", value: "Slack handoff" },
    ],
    productBoxTitle: "What this system does",
    productSteps: [
      { label: "Incoming lead message", text: "\u201cI want to book an appointment\u201d" },
      { label: "AI detection", text: "Booking intent is detected instantly" },
      { label: "Automated response", text: "The booking link is sent automatically" },
      { label: "Urgent fallback", text: "Critical cases trigger a Slack alert for the team" },
    ],
    problemTitle: "The problem this system solves",
    problemText: "Many businesses lose WhatsApp leads because replies are too slow, staff is overloaded, and there is no structured follow-up.",
    problems: ["Replies come too late", "Staff is overwhelmed", "No structured follow-up exists"],
    solutionTitle: "The solution",
    solutionText: "This workflow automates the entire lead journey, from the first message to human escalation when needed.",
    solutions: [
      "Instant AI replies (24/7)",
      "Smart intent detection (inquiry, booking, urgent)",
      "Automated appointment suggestions",
      "Human escalation for critical cases",
      "Slack alerts for team visibility",
    ],
    featuresTitle: "Features",
    featuresText: "This is not just a chatbot. It is a structured lead handling system designed for real business workflows.",
    features: [
      "WhatsApp integration (Meta API)",
      "AI conversational agent",
      "Intent classification (GPT-based)",
      "Urgency detection & escalation",
      "Slack notification system",
      "CRM-ready data structure",
      "Booking link integration (Calendly)",
      "Memory-ready architecture",
    ],
    demoTitle: "Visual demo",
    demoText: "Click any screenshot to open it larger and inspect the workflow, alerts, and end-user experience.",
    workflowTitle: "How the system works",
    workflowText: "For the lead, the experience feels simple. Under the hood, the system routes, qualifies, and escalates using real logic.",
    flowSteps: [
      "Lead sends a message on WhatsApp",
      "AI detects intent (inquiry / booking / urgent)",
      "AI responds instantly",
      "If needed \u2192 escalates to human",
      "Team receives a Slack alert",
      "Lead gets a clear confirmation message",
    ],
    stackTitle: "Tech stack",
    stackText: "The system is built on credible, production-ready tools.",
    stack: ["n8n (workflow automation)", "OpenAI (AI agent)", "WhatsApp Cloud API", "Slack API", "Calendly", "Airtable / Notion / any other CRM"],
    impactTitle: "Business impact",
    impactText: "The value is not just technical. It directly improves speed, workload, and lead conversion.",
    businessResults: [
      "Faster response time (instant vs hours)",
      "Higher lead conversion",
      "Reduced staff workload",
      "Better handling of urgent cases",
    ],
    useCasesTitle: "Other industries this system fits",
    useCasesText: "This flow can be adapted to businesses that rely on messaging, appointments, or fast lead qualification.",
    useCases: {
      "Health & Medical": ["Clinics", "Dentists", "Physiotherapists", "Opticians", "Dermatologists", "Private doctors"],
      "Service Businesses": ["Beauty salons", "Hairdressers", "Spas", "Massage centers", "Tattoo studios"],
      "Local Businesses": ["Car repair shops", "Cleaning services", "Real estate agencies", "Insurance brokers"],
      "High-ticket services": ["Coaches", "Consultants", "Agencies", "Freelancers"],
      "Education": ["Training centers", "Online courses", "Tutors"],
    },
    ctaEyebrow: "Live demo",
    ctaTitle: "Want this system for your business?",
    ctaText: "Test the system logic or contact the business number used for this demo.",
    ctaDemo: "Open visual demo",
    ctaWhatsApp: "Test it live on WhatsApp",
  },
};

function SectionTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div style={{ maxWidth: 720 }}>
      <p
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: AC_TEXT,
          opacity: 0.75,
          marginBottom: 8,
        }}
      >
        {eyebrow}
      </p>
      <h2
        style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: "clamp(1.4rem, 2.5vw, 2rem)",
          fontWeight: 700,
          letterSpacing: "-0.025em",
          color: "#f0f0ef",
          lineHeight: 1.15,
          marginBottom: text ? 12 : 0,
        }}
      >
        {title}
      </h2>
      {text && (
        <p style={{ fontSize: 15, color: "rgba(255,255,255,0.52)", lineHeight: 1.7 }}>
          {text}
        </p>
      )}
    </div>
  );
}

const cardBase: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: "20px 18px",
  transition: "border-color 200ms, transform 200ms",
};

export default function WhatsAppLeadSystemPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [selectedImage, setSelectedImage] = useState<null | { src: string; alt: string }>(null);

  useEffect(() => {
    const saved = localStorage.getItem(LANG_KEY) as Lang | null;
    if (saved === "fr" || saved === "en") setLang(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
  }, [lang]);

  const t = copy[lang];

  const waNumber = "27645528939";
  const waText = encodeURIComponent(
    lang === "fr"
      ? "Bonjour, je veux tester votre système IA WhatsApp en live."
      : "Hi, I want to test your AI WhatsApp system live."
  );
  const waHref = `https://wa.me/${waNumber}?text=${waText}`;

  const demoImages = [
    {
      src: "/demo/n8n-workflow.png",
      alt: lang === "fr" ? "Capture workflow n8n" : "n8n workflow screenshot",
      title: "n8n workflow",
      desc: lang === "fr"
        ? "Le workflow complet : détection du lead, logique de réservation, escalade urgente et handoff humain."
        : "The full workflow covering lead detection, booking logic, urgent escalation, and human handoff.",
    },
    {
      src: "/demo/slack-alert.png",
      alt: lang === "fr" ? "Capture alerte Slack" : "Slack alert screenshot",
      title: "Slack alert",
      desc: lang === "fr"
        ? "L\u2019équipe reçoit une visibilité immédiate quand une intervention humaine est nécessaire."
        : "The team gets immediate visibility when a handoff or urgent case requires human attention.",
    },
    {
      src: "/demo/whatsapp-flow.png",
      alt: lang === "fr" ? "Capture conversation WhatsApp" : "WhatsApp flow screenshot",
      title: "WhatsApp flow",
      desc: lang === "fr"
        ? "Le prospect reçoit une réponse claire et rapide selon son intention."
        : "The lead receives a clear instant reply depending on the detected intent.",
    },
  ];

  const section: React.CSSProperties = { padding: "clamp(42px, 7vw, 64px) 0" };
  const container: React.CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: "0 clamp(16px, 3vw, 24px)" };
  const divider: React.CSSProperties = { border: "none", borderTop: "1px solid rgba(255,255,255,0.06)", margin: 0 };

  return (
    <NavbarFooter agent="whatsapp" lang={lang} onLangChange={setLang}>
      <main style={{ background: "#07111f", color: "#f0f0ef" }}>

        {/* ── HERO ──────────────────────────────────────── */}
        <section
          style={{
            position: "relative",
            overflow: "hidden",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse 60% 70% at 0% 50%, rgba(37,211,102,0.09) 0%, transparent 60%), radial-gradient(ellipse 40% 50% at 100% 20%, rgba(37,211,102,0.05) 0%, transparent 55%)",
              pointerEvents: "none",
            }}
          />

          <div className="responsive-container responsive-hero-shell" style={{ ...container, paddingTop: 64, paddingBottom: 72, position: "relative" }}>
            <div
              className="mobile-split-grid-wide"
              style={{
                display: "grid",
                gridTemplateColumns: "1.15fr 0.85fr",
                gap: 48,
                alignItems: "center",
              }}
            >
              {/* Left */}
              <div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "5px 13px 5px 8px",
                    background: AC_DIM,
                    border: `1px solid ${AC_BORDER}`,
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 500,
                    color: AC_TEXT,
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.06em",
                    marginBottom: 22,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: AC,
                      boxShadow: `0 0 10px ${AC}`,
                      flexShrink: 0,
                    }}
                  />
                  {t.badge}
                </div>

                <h1
                  className="responsive-hero-title"
                  style={{
                    fontFamily: "'Syne', sans-serif",
                    fontSize: "clamp(1.8rem, 3.5vw, 3rem)",
                    fontWeight: 800,
                    lineHeight: 1.07,
                    letterSpacing: "-0.03em",
                    color: "#f0f0ef",
                    marginBottom: 18,
                  }}
                >
                  {t.heroTitle}
                </h1>

                <p className="responsive-body-copy" style={{ fontSize: 16, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, marginBottom: 28, maxWidth: 520 }}>
                  {t.heroSubtitle}
                </p>

                <div className="responsive-hero-actions" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 32 }}>
                  <a
                    href="#demo"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "13px 26px",
                      background: AC,
                      color: "#04110a",
                      fontSize: 14,
                      fontWeight: 700,
                      borderRadius: 999,
                      textDecoration: "none",
                      boxShadow: `0 4px 24px rgba(37,211,102,0.30)`,
                      transition: "opacity 150ms, transform 150ms",
                    }}
                  >
                    {t.primaryCta}
                  </a>

                  <Link
                    href="/"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "12px 22px",
                      background: "transparent",
                      color: "rgba(255,255,255,0.80)",
                      fontSize: 14,
                      fontWeight: 500,
                      borderRadius: 999,
                      textDecoration: "none",
                      border: "1px solid rgba(255,255,255,0.14)",
                      transition: "border-color 150ms, background 150ms",
                    }}
                  >
                    {t.secondaryCta}
                  </Link>
                </div>

                <div className="mobile-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {t.stats.map((stat) => (
                    <div
                      className="responsive-stat-card"
                      key={stat.label}
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 14,
                        padding: "12px 14px",
                        transition: "border-color 200ms",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
                    >
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
                        {stat.label}
                      </p>
                      <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700, color: AC }}>
                        {stat.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right — demo panel */}
              <div
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 24,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    background: "#0b1628",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 16,
                    padding: 16,
                  }}
                >
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>
                    {t.productBoxTitle}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {t.productSteps.map((step, i) => {
                      const isLast = i === t.productSteps.length - 1;
                      return (
                        <div
                          key={step.label}
                          style={{
                            background: isLast ? AC_DIM : "rgba(255,255,255,0.04)",
                            border: `1px solid ${isLast ? AC_BORDER : "rgba(255,255,255,0.07)"}`,
                            borderRadius: 12,
                            padding: "10px 14px",
                          }}
                        >
                          <p style={{ fontSize: 9, color: isLast ? AC_TEXT : "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                            {step.label}
                          </p>
                          <p style={{ fontSize: 13, color: isLast ? "#f0f0ef" : "rgba(255,255,255,0.72)" }}>
                            {step.text}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── PROBLEM ───────────────────────────────────── */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Problème" : "Problem"} title={t.problemTitle} text={t.problemText} />
            <div className="mobile-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 32 }}>
              {t.problems.map((item) => (
                <div
                  className="responsive-info-card"
                  key={item}
                  style={cardBase}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.30)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 8px rgba(239,68,68,0.5)", marginBottom: 14 }} />
                  <p style={{ fontSize: 15, fontWeight: 500, color: "rgba(255,255,255,0.82)", lineHeight: 1.5 }}>{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* ── SOLUTION ──────────────────────────────────── */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Solution" : "Solution"} title={t.solutionTitle} text={t.solutionText} />
            <div className="mobile-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 32 }}>
              {t.solutions.map((item, index) => (
                <div
                  className="responsive-info-card"
                  key={item}
                  style={cardBase}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: AC_DIM, border: `1px solid ${AC_BORDER}`, color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                    {index + 1}
                  </div>
                  <p style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* ── FEATURES ──────────────────────────────────── */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Fonctionnalités" : "Features"} title={t.featuresTitle} text={t.featuresText} />
            <div className="mobile-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 32 }}>
              {t.features.map((item) => (
                <div
                  className="responsive-feature-card"
                  key={item}
                  style={{ ...cardBase, padding: "14px 16px" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.55 }}>{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* ── VISUAL DEMO ───────────────────────────────── */}
        <section id="demo" style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Démo visuelle" : "Visual demo"} title={t.demoTitle} text={t.demoText} />
            <div className="mobile-grid-3 responsive-gallery-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginTop: 32 }}>
              {demoImages.map((img) => (
                <button
                  key={img.src}
                  type="button"
                  onClick={() => setSelectedImage({ src: img.src, alt: img.alt })}
                  style={{ ...cardBase, textAlign: "left", cursor: "pointer", background: "rgba(255,255,255,0.03)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  <div style={{ overflow: "hidden", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", marginBottom: 14 }}>
                    <Image src={img.src} alt={img.alt} width={1400} height={900} style={{ width: "100%", height: "auto", display: "block", transition: "transform 400ms" }} />
                  </div>
                  <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700, color: "#f0f0ef", marginBottom: 6 }}>{img.title}</h3>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>{img.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* ── WORKFLOW ───────────────────────────────────── */}
        <section style={section}>
          <div style={container}>
            <div className="mobile-split-grid" style={{ display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 48, alignItems: "start" }}>
              <SectionTitle eyebrow="Workflow" title={t.workflowTitle} text={t.workflowText} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {t.flowSteps.map((step, index) => (
                  <div
                    key={step}
                    style={{ display: "flex", gap: 14, alignItems: "center", ...cardBase, padding: "14px 18px" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
                  >
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: AC_DIM, border: `1px solid ${AC_BORDER}`, color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {index + 1}
                    </div>
                    <p style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", lineHeight: 1.55 }}>{step}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* ── STACK + IMPACT ────────────────────────────── */}
        <section style={section}>
          <div style={container}>
            <div className="mobile-grid-2-even responsive-two-up-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ ...cardBase, borderRadius: 24, padding: 28 }}>
                <SectionTitle eyebrow={lang === "fr" ? "Stack technique" : "Tech stack"} title={t.stackTitle} text={t.stackText} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
                  {t.stack.map((item) => (
                    <span
                      key={item}
                      style={{ padding: "6px 14px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)", fontSize: 13, color: "rgba(255,255,255,0.68)", transition: "border-color 150ms, color 150ms", cursor: "default" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.color = AC_TEXT; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.10)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.68)"; }}
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ ...cardBase, borderRadius: 24, padding: 28 }}>
                <SectionTitle eyebrow={lang === "fr" ? "Impact business" : "Business impact"} title={t.impactTitle} text={t.impactText} />
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
                  {t.businessResults.map((item) => (
                    <div
                      key={item}
                      style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "11px 14px", fontSize: 13.5, color: "rgba(255,255,255,0.72)", transition: "border-color 150ms" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; }}
                    >
                      <span style={{ color: AC, fontSize: 12, flexShrink: 0 }}>✓</span>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* ── USE CASES ─────────────────────────────────── */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Cas d'usage" : "Use cases"} title={t.useCasesTitle} text={t.useCasesText} />
            <div className="mobile-grid-3 responsive-category-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 32 }}>
              {Object.entries(t.useCases).map(([category, items]) => (
                <div
                  key={category}
                  style={cardBase}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 15, fontWeight: 700, color: "#f0f0ef", marginBottom: 14 }}>{category}</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {items.map((item) => (
                      <span key={item} style={{ padding: "5px 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", fontSize: 12.5, color: "rgba(255,255,255,0.65)" }}>
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA FINAL ─────────────────────────────────── */}
        <section style={{ ...section, paddingTop: 0 }}>
          <div style={container}>
            <div
              className="responsive-cta-card"
              style={{
                background: "linear-gradient(135deg, rgba(37,211,102,0.08) 0%, rgba(255,255,255,0.02) 50%, rgba(37,211,102,0.05) 100%)",
                border: `1px solid ${AC_BORDER}`,
                borderRadius: 28,
                padding: "48px 36px",
                textAlign: "center",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${AC}, transparent)` }} />
              <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: AC_TEXT, marginBottom: 14 }}>
                {t.ctaEyebrow}
              </p>
              <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "clamp(1.5rem, 2.5vw, 2.2rem)", fontWeight: 800, color: "#f0f0ef", letterSpacing: "-0.025em", marginBottom: 12 }}>
                {t.ctaTitle}
              </h2>
              <p className="responsive-body-copy" style={{ fontSize: 15, color: "rgba(255,255,255,0.52)", lineHeight: 1.7, maxWidth: 520, margin: "0 auto 28px" }}>
                {t.ctaText}
              </p>
              <div className="responsive-cta-actions" style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
                <a
                  href="#demo"
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 26px", background: "rgba(255,255,255,0.08)", color: "#f0f0ef", fontSize: 14, fontWeight: 600, borderRadius: 999, textDecoration: "none", border: "1px solid rgba(255,255,255,0.16)", transition: "background 150ms" }}
                >
                  {t.ctaDemo}
                </a>
                <a
                  href={waHref}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 26px", background: AC, color: "#04110a", fontSize: 14, fontWeight: 700, borderRadius: 999, textDecoration: "none", boxShadow: `0 6px 28px rgba(37,211,102,0.28)`, transition: "opacity 150ms, transform 150ms" }}
                >
                  {t.ctaWhatsApp}
                </a>
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* ── Lightbox ───────────────────────────────────── */}
      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.85)", padding: 16 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", maxHeight: "95vh", maxWidth: "95vw" }}>
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              style={{ position: "absolute", right: 12, top: 12, zIndex: 10, borderRadius: 999, background: "rgba(0,0,0,0.70)", border: "none", color: "white", padding: "4px 12px", fontSize: 13, cursor: "pointer" }}
            >
              ✕
            </button>
            <Image
              src={selectedImage.src}
              alt={selectedImage.alt}
              width={1800}
              height={1200}
              style={{ maxHeight: "90vh", width: "auto", borderRadius: 16, objectFit: "contain" }}
            />
          </div>
        </div>
      )}
    </NavbarFooter>
  );
}
