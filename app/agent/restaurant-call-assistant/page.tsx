"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import NavbarFooter from "../../components/NavbarFooter";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { persistRestaurantLang } from "@/components/restaurant-language/RestaurantLanguageToggle";
import { RESTAURANT_LANG_KEY } from "@/lib/restaurant-language";

type Lang = "fr" | "en";

const LANG_KEY = RESTAURANT_LANG_KEY;

// -- Accent colors (premium hospitality identity) ------------
const AC = "#F59E0B";
const AC_DIM = "rgba(245,158,11,0.10)";
const AC_BORDER = "rgba(245,158,11,0.24)";
const AC_TEXT = "#FBBF24";
const AC_SHADOW = "rgba(245,158,11,0.28)";
const CALL_TEST_HREF = "/restaurant-call-test";
const CLIENT_LOGIN_HREF = "/restaurant-login";
const CLIENT_DASHBOARD_HREF = "/restaurant-analytics/overview";

const copy = {
  fr: {
    badge: "AI Restaurant Call Assistant",
    heroTitle: "Un assistant IA qui répond aux appels, prend les réservations et protège ton service en salle.",
    heroSubtitle:
      "Pensé pour les restaurants, groupes multi-sites et concepts hospitality premium, ce système gère les appels entrants, route les intentions, mémorise les préférences client et escalade proprement vers l'humain quand c'est nécessaire.",
    testCta: "Tester l'outil",
    clientLoginCta: "Accès dashboard",
    primaryCta: "Voir le workflow",
    secondaryCta: "Retour à l'accueil",
    stats: [
      { label: "Disponibilité", value: "24/7" },
      { label: "Couverture", value: "Calls • Booking • FAQ" },
      { label: "Pilotage", value: "Par restaurant & location" },
    ],
    productBoxTitle: "Expérience d'appel",
    productSteps: [
      { label: "Appel entrant", text: "Le client appelle pour réserver, modifier ou poser une question." },
      { label: "Routage d'intention", text: "L'IA identifie réservation, FAQ, privatisation, retard, allergie ou urgence." },
      { label: "Action structurée", text: "Le système confirme la demande, collecte les détails et met à jour le suivi." },
      { label: "Handoff humain", text: "Les cas sensibles sont transférés avec contexte, historique et raison d'escalade." },
    ],
    problemTitle: "Le problème que ce système résout",
    problemText:
      "Dans un restaurant, chaque appel arrive au mauvais moment : pendant le rush, pendant le service, ou quand personne n'est disponible. Résultat : réservations perdues, équipe interrompue et aucune visibilité sur ce qui a été manqué.",
    problems: [
      "Appels manqués pendant les pics de service",
      "Réservations perdues ou mal qualifiées",
      "Interruptions constantes de l'équipe en salle",
      "Gestion fragile des demandes complexes",
      "Peu de visibilité sur les escalades et handoffs",
      "Aucune lecture claire par restaurant ou localisation",
    ],
    solutionTitle: "La solution",
    solutionText:
      "AI Restaurant Call Assistant agit comme une couche opérationnelle entre les clients et l'équipe. Il répond, comprend, collecte, réserve, mémorise et transmet uniquement ce qui mérite une intervention humaine.",
    solutions: [
      "Réponse automatique aux appels entrants, même hors horaires",
      "Prise de réservation avec collecte des détails utiles",
      "Réponses aux questions fréquentes : horaires, menu, parking, allergies, privatisations",
      "Routage intelligent vers réservation, FAQ, modification, annulation ou escalade",
      "Mémoire client pour préférences, demandes récurrentes et contexte utile",
      "Handoffs structurés avec résumé, priorité et raison d'escalade",
    ],
    differenceTitle: "Ce qui le rend exceptionnel",
    differenceText:
      "Ce n'est pas un simple répondeur vocal. C'est une architecture multi-agent pensée pour la production, avec mémoire, logique métier et analytics exploitables par les équipes opérationnelles.",
    differentiators: [
      { title: "Architecture multi-agent", text: "Un agent qualifie l'intention, un autre gère la réservation, un autre prépare le handoff ou les analytics." },
      { title: "Mémoire client utile", text: "Le système conserve les préférences pertinentes : table calme, allergie, anniversaire, historique de réservation ou VIP." },
      { title: "Routage intelligent", text: "Chaque appel est dirigé vers le bon flow selon l'intention, le restaurant, la localisation et le niveau d'urgence." },
      { title: "Approche production-ready", text: "Pensé pour logs, fallback, escalade humaine, monitoring et exploitation réelle, pas seulement pour une démo." },
    ],
    workflowTitle: "Comment le système fonctionne",
    workflowText:
      "Le client vit une conversation simple. En coulisses, le système orchestre plusieurs décisions pour réduire le bruit et augmenter la qualité de service.",
    flowSteps: [
      "Le client appelle le restaurant ou une ligne centralisée",
      "L'IA identifie l'intention et la localisation concernée",
      "Le bon agent prend le relais : booking, FAQ, modification, VIP ou escalade",
      "Les détails utiles sont collectés : date, heure, personnes, allergies, préférence",
      "La réservation, le reminder ou le suivi est créé dans les outils connectés",
      "Si besoin, un humain reçoit un handoff avec résumé et contexte complet",
      "Les analytics alimentent la vue restaurant, groupe et localisation",
    ],
    featuresTitle: "Fonctionnalités",
    featuresText:
      "Le système couvre les appels du quotidien, les moments de rush et les cas qui demandent une attention humaine sans perdre le contexte.",
    features: [
      "Réponse vocale IA aux appels entrants",
      "Prise de réservation guidée",
      "FAQ restaurant configurable",
      "Routage par intention",
      "Escalade humaine priorisée",
      "Mémoire client et préférences",
      "Suivi des handoffs",
      "Reminders et confirmations",
      "Vue multi-tenant",
      "Vue par localisation",
      "Logs d'appels et raisons d'escalade",
      "Connecteurs CRM / table booking / ops tools",
    ],
    analyticsTitle: "Analytics restaurant & multi-location",
    analyticsText:
      "Les managers ne voient pas seulement le volume d'appels. Ils comprennent ce qui se passe : pourquoi les clients appellent, où les handoffs se produisent, quelles locations perdent le plus d'opportunités et quels sujets saturent l'équipe.",
    analytics: [
      { label: "Calls handled", value: "1,284", text: "Appels traités automatiquement sur la période." },
      { label: "Bookings captured", value: "412", text: "Réservations créées ou qualifiées par l'assistant." },
      { label: "Human handoffs", value: "7.8%", text: "Escalades avec contexte transmis à l'équipe." },
      { label: "Top intent", value: "Booking", text: "Motif principal par restaurant et localisation." },
    ],
    impactTitle: "Impact business",
    impactText:
      "La valeur est opérationnelle : moins d'appels perdus, moins d'interruptions, plus de réservations capturées et une meilleure lecture de la demande client.",
    businessResults: [
      "Réduction des appels manqués pendant le service",
      "Plus de réservations capturées hors horaires ou pendant les rushs",
      "Moins d'interruptions pour l'équipe en salle",
      "Escalades plus propres, avec contexte et priorité",
      "Meilleure expérience client avant même l'arrivée au restaurant",
      "Pilotage centralisé pour groupes, franchises et multi-sites",
    ],
    useCasesTitle: "Cas d'usage",
    useCasesText:
      "Le système peut être adapté à plusieurs modèles de restauration et d'hospitality où les appels sont fréquents, répétitifs ou difficiles à gérer pendant le service.",
    useCases: {
      "Restaurants premium": ["Réservations", "Demandes VIP", "Allergies", "Anniversaires"],
      "Groupes multi-sites": ["Vue par location", "Comparaison des handoffs", "Pilotage centralisé"],
      "Concepts à fort volume": ["Rush du soir", "Takeaway", "Modifications de réservation"],
      "Hospitality": ["Rooftops", "Bars à cocktails", "Beach clubs", "Private dining"],
      "Franchises": ["Standardisation des réponses", "Reporting par site", "Qualité opérationnelle"],
    },
    ctaEyebrow: "Production-ready",
    ctaTitle: "Tu veux transformer les appels de ton restaurant en réservations mesurables ?",
    ctaText:
      "Cette page présente la structure produit. Le système peut ensuite être connecté à tes outils de réservation, ton CRM, ton Slack ou ton dashboard opérationnel.",
    ctaPrimary: "Parler du système",
    ctaSecondary: "Retour à l'acceuil",
  },
  en: {
    badge: "AI Restaurant Call Assistant",
    heroTitle: "An AI assistant that answers calls, takes bookings, and protects your front-of-house team.",
    heroSubtitle:
      "Built for restaurants, multi-location groups, and premium hospitality concepts, this system handles inbound calls, routes intent, remembers useful customer context, and escalates cleanly to humans when needed.",
    testCta: "Test the tool",
    clientLoginCta: "Dashboard access",
    primaryCta: "View workflow",
    secondaryCta: "Back to homepage",
    stats: [
      { label: "Availability", value: "24/7" },
      { label: "Coverage", value: "Calls • Booking • FAQ" },
      { label: "Visibility", value: "By restaurant & location" },
    ],
    productBoxTitle: "Call experience",
    productSteps: [
      { label: "Incoming call", text: "A guest calls to book, modify, cancel, or ask a question." },
      { label: "Intent routing", text: "The AI identifies booking, FAQ, private dining, delay, allergy, or urgent intent." },
      { label: "Structured action", text: "The system confirms the request, collects details, and updates the tracking layer." },
      { label: "Human handoff", text: "Sensitive cases are transferred with context, history, and escalation reason." },
    ],
    problemTitle: "The problem this system solves",
    problemText:
      "In restaurants, calls arrive at the worst possible time: during rush, during service, or when nobody is available. The result is missed bookings, interrupted staff, and no visibility over what was lost.",
    problems: [
      "Missed calls during service peaks",
      "Lost or poorly qualified bookings",
      "Constant interruptions for front-of-house staff",
      "Fragile handling of complex requests",
      "Limited visibility over escalations and handoffs",
      "No clear reporting by restaurant or location",
    ],
    solutionTitle: "The solution",
    solutionText:
      "AI Restaurant Call Assistant acts as an operational layer between guests and the team. It answers, understands, collects, books, remembers, and only escalates what truly needs a human.",
    solutions: [
      "Automatic call handling, including after-hours coverage",
      "Booking capture with the right operational details",
      "Answers for common questions: opening hours, menu, parking, allergies, private dining",
      "Smart routing across booking, FAQ, modification, cancellation, or escalation",
      "Customer memory for preferences, recurring requests, and useful context",
      "Structured handoffs with summary, priority, and escalation reason",
    ],
    differenceTitle: "What makes it exceptional",
    differenceText:
      "This is not a basic voice bot. It is a production-minded multi-agent architecture with memory, business logic, and analytics that operators can actually use.",
    differentiators: [
      { title: "Multi-agent architecture", text: "One agent qualifies intent, another handles booking, another prepares handoff or analytics." },
      { title: "Useful customer memory", text: "The system keeps relevant preferences: quiet table, allergy, birthday, booking history, or VIP status." },
      { title: "Intelligent routing", text: "Each call moves into the right flow based on intent, restaurant, location, and urgency level." },
      { title: "Production-ready approach", text: "Designed for logs, fallback, human escalation, monitoring, and real operations, not just a demo." },
    ],
    workflowTitle: "How the system works",
    workflowText:
      "The guest experiences a simple conversation. Behind the scenes, the system orchestrates multiple decisions to reduce noise and improve service quality.",
    flowSteps: [
      "The guest calls the restaurant or a centralized number",
      "The AI identifies the intent and the relevant location",
      "The right agent takes over: booking, FAQ, modification, VIP, or escalation",
      "Useful details are collected: date, time, party size, allergies, preferences",
      "The booking, reminder, or follow-up is created in connected tools",
      "When needed, a human receives a handoff with summary and full context",
      "Analytics feed restaurant, group, and location-level reporting",
    ],
    featuresTitle: "Features",
    featuresText:
      "The system covers everyday calls, peak-time pressure, and human-sensitive cases without dropping context.",
    features: [
      "AI voice response for inbound calls",
      "Guided booking capture",
      "Configurable restaurant FAQ",
      "Intent-based routing",
      "Prioritized human escalation",
      "Customer memory and preferences",
      "Handoff tracking",
      "Reminders and confirmations",
      "Multi-tenant view",
      "Location-level view",
      "Call logs and escalation reasons",
      "CRM / booking / ops tool connectors",
    ],
    analyticsTitle: "Restaurant & multi-location analytics",
    analyticsText:
      "Managers do not just see call volume. They understand what happened: why guests called, where handoffs occur, which locations lose the most opportunities, and which topics overload the team.",
    analytics: [
      { label: "Calls handled", value: "1,284", text: "Calls automatically handled during the period." },
      { label: "Bookings captured", value: "412", text: "Bookings created or qualified by the assistant." },
      { label: "Human handoffs", value: "7.8%", text: "Escalations transferred with context to the team." },
      { label: "Top intent", value: "Booking", text: "Main reason by restaurant and location." },
    ],
    impactTitle: "Business impact",
    impactText:
      "The value is operational: fewer missed calls, fewer interruptions, more captured bookings, and a clearer view of guest demand.",
    businessResults: [
      "Fewer missed calls during service",
      "More bookings captured after hours or during rush",
      "Fewer interruptions for front-of-house teams",
      "Cleaner escalations with context and priority",
      "Better guest experience before arrival",
      "Centralized reporting for groups, franchises, and multi-site operations",
    ],
    useCasesTitle: "Use cases",
    useCasesText:
      "The system can be adapted to restaurant and hospitality models where calls are frequent, repetitive, or difficult to handle during service.",
    useCases: {
      "Premium restaurants": ["Bookings", "VIP requests", "Allergies", "Birthdays"],
      "Multi-location groups": ["Location view", "Handoff comparison", "Centralized operations"],
      "High-volume concepts": ["Dinner rush", "Takeaway", "Booking modifications"],
      "Hospitality": ["Rooftops", "Cocktail bars", "Beach clubs", "Private dining"],
      "Franchises": ["Standardized answers", "Site-level reporting", "Operational quality"],
    },
    ctaEyebrow: "Production-ready",
    ctaTitle: "Want to turn restaurant calls into measurable bookings?",
    ctaText:
      "This page presents the product structure. The system can then be connected to your booking tools, CRM, Slack, or operations dashboard.",
    ctaPrimary: "Discuss the system",
    ctaSecondary: "Back to homepage",
  },
};

function CallTestButton({
  children,
  shadow = "0 4px 24px",
}: {
  children: React.ReactNode;
  shadow?: string;
}) {
  return (
    <Link
      href={CALL_TEST_HREF}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "13px 26px",
        background: AC,
        color: "#160b02",
        fontSize: 14,
        fontWeight: 700,
        borderRadius: 999,
        textDecoration: "none",
        boxShadow: `${shadow} ${AC_SHADOW}`,
        transition: "opacity 150ms, transform 150ms",
      }}
    >
      {children}
    </Link>
  );
}

function ClientLoginButton({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  async function handleClientDashboardClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();

    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();

    if (!data.session) {
      router.push(CLIENT_LOGIN_HREF);
      return;
    }

    const sessionResponse = await fetch("/api/restaurant-auth/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }),
    });

    if (!sessionResponse.ok) {
      router.push(CLIENT_LOGIN_HREF);
      return;
    }

    router.refresh();
    router.push(CLIENT_DASHBOARD_HREF);
  }

  return (
    <Link
      href={CLIENT_LOGIN_HREF}
      onClick={handleClientDashboardClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "13px 24px",
        background: AC_DIM,
        color: AC_TEXT,
        fontSize: 14,
        fontWeight: 700,
        borderRadius: 999,
        textDecoration: "none",
        border: `1px solid ${AC_BORDER}`,
        transition: "background 150ms, border-color 150ms",
      }}
    >
      {children}
    </Link>
  );
}

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
          opacity: 0.78,
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
      {text && <p style={{ fontSize: 15, color: "rgba(255,255,255,0.52)", lineHeight: 1.7 }}>{text}</p>}
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

export default function RestaurantCallAssistantPage() {
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    const saved = localStorage.getItem(LANG_KEY) as Lang | null;
    if (saved === "fr" || saved === "en") setLang(saved);
  }, []);

  useEffect(() => {
    persistRestaurantLang(lang);
  }, [lang]);

  const t = copy[lang];

  const section: React.CSSProperties = { padding: "clamp(42px, 7vw, 64px) 0" };
  const container: React.CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: "0 clamp(16px, 3vw, 24px)" };
  const divider: React.CSSProperties = { border: "none", borderTop: "1px solid rgba(255,255,255,0.06)", margin: 0 };
  const dashboardPreviewKpis = [
    { label: "Total Calls", value: "1,284", detail: lang === "fr" ? "Appels entrants traités" : "Inbound calls handled" },
    { label: "Bookings", value: "412", detail: lang === "fr" ? "Réservations capturées" : "Bookings captured" },
    { label: "Auto Handled", value: "86%", detail: lang === "fr" ? "Résolus sans intervention" : "Resolved without staff" },
    { label: "Handoffs", value: "7.8%", detail: lang === "fr" ? "Escalades humaines" : "Human escalations" },
  ];
  const dashboardTenantRows = [
    { name: "Maison Group", calls: "684", bookings: "218", handoffs: "6.1%" },
    { name: "Table & Fire", calls: "438", bookings: "151", handoffs: "4.8%" },
    { name: "Harbor Dining", calls: "392", bookings: "126", handoffs: "8.3%" },
  ];
  const dashboardLocationRows = [
    { name: "Downtown", calls: "512", topIntent: "Booking", quality: "94%" },
    { name: "Waterfront", calls: "467", topIntent: "FAQ", quality: "91%" },
    { name: "West End", calls: "389", topIntent: "Private dining", quality: "88%" },
  ];
  const pricingCopy =
    lang === "fr"
      ? {
          roiEyebrow: "ROI",
          roiTitle: "Pas seulement un assistant d'appel. Un système de récupération de revenus.",
          roiText:
            "Chaque appel manqué peut signifier une table manquée. AI Restaurant Call Assistant répond instantanément, capture les réservations, envoie les confirmations, relance automatiquement et donne une lecture claire des appels, réservations et revenus récupérés.",
          pricingEyebrow: "Packages",
          pricingTitle: "Choisis le niveau adapté à ton volume d'appels",
          pricingText:
            "Trois plans clairs pour lancer rapidement, absorber les pics d'appels et évoluer vers des opérations multi-sites avec intégrations avancées.",
          setupLabel: "Setup",
          includedLabel: "Inclus",
          popularBadge: "Most Popular",
          note: "Plans can be adapted depending on call volume, number of locations, and integration needs.",
          comparisonTitle: "Comparaison des plans",
          comparisonText: "Une vue simple des capacités clés incluses dans chaque package.",
          plans: [
            {
              name: "Growth",
              price: "€299",
              suffix: "/month",
              setup: "€800",
              positioning: "Pour les restaurants indépendants sérieux.",
              cta: "Start with Growth",
              featured: false,
              features: [
                "300 calls/month",
                "Simple reservation handling",
                "Basic FAQ answers",
                "SMS confirmation for customers",
                "Smart escalation to staff",
                "Dashboard: calls to recovered reservations",
                "Automatic CRM update",
                "Optimized standard script",
              ],
            },
            {
              name: "Pro",
              price: "€599",
              suffix: "/month",
              setup: "€1200",
              positioning: "Pour les restaurants occupés avec un fort volume d'appels.",
              cta: "Choose Pro",
              featured: true,
              features: [
                "Everything in Growth",
                "1000 calls/month",
                "Priority handling for VIPs and groups",
                "Automatic WhatsApp + SMS follow-ups",
                "Advanced escalation for complex cases",
                "Advanced analytics and recovered revenue",
                "Custom restaurant script",
                "Monthly script optimization",
                "Priority support",
              ],
            },
            {
              name: "Premium",
              price: "€999+",
              suffix: "/month",
              setup: "€1500+",
              positioning: "Pour les chaînes et restaurants multi-sites.",
              cta: "Book a Premium Demo",
              featured: false,
              features: [
                "Everything in Pro",
                "3000 calls/month",
                "Multi-location support",
                "Custom AI flows for specific cases",
                "Advanced booking, CRM, and internal integrations",
                "Custom reporting",
                "Monthly follow-up and optimization",
                "Dedicated support",
              ],
            },
          ],
        }
      : {
          roiEyebrow: "ROI",
          roiTitle: "Not just a call assistant. A revenue recovery system.",
          roiText:
            "Every missed call can mean a missed table. The AI Restaurant Call Assistant answers instantly, captures bookings, sends confirmations, follows up automatically, and gives you clear analytics on calls, reservations, and recovered revenue.",
          pricingEyebrow: "Packages",
          pricingTitle: "Choose the level that matches your call volume",
          pricingText:
            "Three clear plans to launch fast, absorb busy service peaks, and scale into multi-location operations with advanced integrations.",
          setupLabel: "Setup",
          includedLabel: "Included",
          popularBadge: "Most Popular",
          note: "Plans can be adapted depending on call volume, number of locations, and integration needs.",
          comparisonTitle: "Plan comparison",
          comparisonText: "A simple view of the key capabilities included in each package.",
          plans: [
            {
              name: "Growth",
              price: "€299",
              suffix: "/month",
              setup: "€800",
              positioning: "For serious independent restaurants.",
              cta: "Start with Growth",
              featured: false,
              features: [
                "300 calls/month",
                "Simple reservation handling",
                "Basic FAQ answers: opening hours, address, common questions",
                "SMS confirmation for customers",
                "Smart escalation to staff",
                "Dashboard: calls to recovered reservations",
                "Automatic CRM update",
                "Optimized standard script",
              ],
            },
            {
              name: "Pro",
              price: "€599",
              suffix: "/month",
              setup: "€1200",
              positioning: "For busy restaurants with high call volume.",
              cta: "Choose Pro",
              featured: true,
              features: [
                "Everything in Growth",
                "1000 calls/month",
                "Priority handling for important calls: VIPs, groups",
                "Automatic WhatsApp + SMS follow-ups",
                "Advanced escalation for complex cases",
                "Advanced analytics: conversion, lost calls, recovered revenue",
                "Custom script adapted to the restaurant",
                "Monthly script optimization",
                "Priority support",
              ],
            },
            {
              name: "Premium",
              price: "€999+",
              suffix: "/month",
              setup: "€1500+",
              positioning: "For chains and multi-location restaurants.",
              cta: "Book a Premium Demo",
              featured: false,
              features: [
                "Everything in Pro",
                "3000 calls/month",
                "Multi-location support",
                "Custom AI flows for specific cases",
                "Advanced integrations: booking systems, CRM, internal tools",
                "Custom reporting",
                "Monthly follow-up and continuous optimization",
                "Dedicated support",
              ],
            },
          ],
        };
  const comparisonRows = [
    { feature: "Monthly calls", growth: "300", pro: "1000", premium: "3000" },
    { feature: "Reservation handling", growth: "Yes", pro: "Yes", premium: "Yes" },
    { feature: "Basic FAQ", growth: "Yes", pro: "Yes", premium: "Yes" },
    { feature: "SMS confirmation", growth: "Yes", pro: "Yes", premium: "Yes" },
    { feature: "WhatsApp + SMS follow-up", growth: "No", pro: "Yes", premium: "Yes" },
    { feature: "Smart escalation", growth: "Yes", pro: "Yes", premium: "Yes" },
    { feature: "Advanced escalation", growth: "No", pro: "Yes", premium: "Yes" },
    { feature: "CRM update", growth: "Yes", pro: "Yes", premium: "Yes" },
    { feature: "Basic dashboard", growth: "Basic", pro: "Advanced", premium: "Advanced + custom" },
    { feature: "Advanced analytics", growth: "No", pro: "Yes", premium: "Yes" },
    { feature: "Multi-location", growth: "No", pro: "No", premium: "Yes" },
    { feature: "Custom AI flows", growth: "No", pro: "No", premium: "Yes" },
    { feature: "Advanced integrations", growth: "No", pro: "No", premium: "Yes" },
    { feature: "Custom reporting", growth: "No", pro: "No", premium: "Yes" },
    { feature: "Support level", growth: "Standard", pro: "Priority", premium: "Dedicated" },
  ];
  const previewCellStyle: React.CSSProperties = {
    padding: "11px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    fontSize: 12.5,
    color: "rgba(255,255,255,0.64)",
    whiteSpace: "normal",
  };
  const previewHeadStyle: React.CSSProperties = {
    ...previewCellStyle,
    color: "rgba(255,255,255,0.34)",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };

  return (
    <NavbarFooter agent="restaurant" lang={lang} onLangChange={setLang}>
      <main style={{ background: "#07111f", color: "#f0f0ef" }}>

        {/* -- HERO ------------------------------------------------ */}
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
                "radial-gradient(ellipse 60% 70% at 0% 50%, rgba(245,158,11,0.12) 0%, transparent 60%), radial-gradient(ellipse 42% 52% at 100% 18%, rgba(180,83,9,0.12) 0%, transparent 58%)",
              pointerEvents: "none",
            }}
          />

          <div className="responsive-container responsive-hero-shell" style={{ ...container, paddingTop: 64, paddingBottom: 72, position: "relative" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
                gap: 48,
                alignItems: "center",
              }}
            >
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

                <p className="responsive-body-copy" style={{ fontSize: 16, color: "rgba(255,255,255,0.58)", lineHeight: 1.7, marginBottom: 28, maxWidth: 560 }}>
                  {t.heroSubtitle}
                </p>

                <div className="responsive-hero-actions" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 32 }}>
                  <CallTestButton>
                    {t.testCta}
                  </CallTestButton>

                  <ClientLoginButton>
                    {t.clientLoginCta}
                  </ClientLoginButton>

                  <a
                    href="#workflow"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "13px 26px",
                      background: "rgba(255,255,255,0.08)",
                      color: "#f0f0ef",
                      fontSize: 14,
                      fontWeight: 600,
                      borderRadius: 999,
                      textDecoration: "none",
                      border: "1px solid rgba(255,255,255,0.16)",
                      transition: "background 150ms",
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

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
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
                      <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700, color: AC_TEXT }}>
                        {stat.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 24,
                  padding: 16,
                  boxShadow: "0 24px 80px rgba(0,0,0,0.22)",
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
                  <div className="mobile-card-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      {t.productBoxTitle}
                    </p>
                    <span style={{ width: 42, height: 42, borderRadius: "50%", background: AC_DIM, border: `1px solid ${AC_BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", color: AC_TEXT, fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800 }}>
                      AI
                    </span>
                  </div>

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
                          <p style={{ fontSize: 13, color: isLast ? "#f0f0ef" : "rgba(255,255,255,0.72)", lineHeight: 1.45 }}>
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

        {/* -- PROBLEM --------------------------------------------- */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Problème" : "Problem"} title={t.problemTitle} text={t.problemText} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 32 }}>
              {t.problems.map((item) => (
                <div
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

        {/* -- SOLUTION -------------------------------------------- */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Solution" : "Solution"} title={t.solutionTitle} text={t.solutionText} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 32 }}>
              {t.solutions.map((item, index) => (
                <div
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

        {/* -- DIFFERENTIATION ------------------------------------- */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Différenciation" : "Differentiation"} title={t.differenceTitle} text={t.differenceText} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 32 }}>
              {t.differentiators.map((item) => (
                <div
                  key={item.title}
                  style={{ ...cardBase, padding: "22px 18px" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: AC, boxShadow: `0 0 10px ${AC}`, marginBottom: 14 }} />
                  <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 15, fontWeight: 700, color: "#f0f0ef", lineHeight: 1.25, marginBottom: 8 }}>{item.title}</h3>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.56)", lineHeight: 1.62 }}>{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* -- WORKFLOW -------------------------------------------- */}
        <section id="workflow" style={section}>
          <div style={container}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 48, alignItems: "start" }}>
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

        {/* -- FEATURES -------------------------------------------- */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Fonctionnalités" : "Features"} title={t.featuresTitle} text={t.featuresText} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginTop: 32 }}>
              {t.features.map((item) => (
                <div
                  key={item}
                  style={{ ...cardBase, padding: "14px 16px" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.66)", lineHeight: 1.55 }}>{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* -- ANALYTICS ------------------------------------------- */}
        <section style={section}>
          <div style={container}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 28, alignItems: "start" }}>
              <SectionTitle eyebrow="Analytics" title={t.analyticsTitle} text={t.analyticsText} />
              <div style={{ ...cardBase, borderRadius: 24, padding: 18, background: "rgba(255,255,255,0.035)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                  {t.analytics.map((item) => (
                    <div
                      key={item.label}
                      style={{
                        borderRadius: 16,
                        padding: "16px 14px",
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(11,22,40,0.76)",
                      }}
                    >
                      <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.36)", marginBottom: 7 }}>{item.label}</p>
                      <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "1.8rem", lineHeight: 1, fontWeight: 800, color: AC_TEXT, letterSpacing: "-0.035em", marginBottom: 8 }}>{item.value}</p>
                      <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "rgba(255,255,255,0.55)" }}>{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* -- DASHBOARD PREVIEW ----------------------------------- */}
        <section style={section}>
          <div style={container}>
            <SectionTitle
              eyebrow="Dashboard preview"
              title={lang === "fr" ? "Une vue claire sur les appels, réservations et escalades" : "A clear view of calls, bookings, and escalations"}
              text={
                lang === "fr"
                  ? "Le dashboard donne aux équipes une lecture opérationnelle par groupe, restaurant et localisation, avec les signaux utiles pour piloter la qualité du service."
                  : "The dashboard gives teams an operational view by group, restaurant, and location, with the right signals to manage service quality."
              }
            />

            <div
              style={{
                marginTop: 32,
                border: `1px solid ${AC_BORDER}`,
                background: "linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(255,255,255,0.025) 42%, rgba(180,83,9,0.07) 100%)",
                borderRadius: 28,
                padding: "clamp(18px, 3vw, 28px)",
                boxShadow: "0 28px 90px rgba(0,0,0,0.26)",
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, marginBottom: 18, flexWrap: "wrap" }}>
                <div>
                  <p style={{ color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
                    AI Restaurant Call Assistant
                  </p>
                  <h3 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: "clamp(1.25rem, 2vw, 1.8rem)", letterSpacing: "-0.025em", marginBottom: 6 }}>
                    Restaurant Analytics Overview
                  </h3>
                  <p style={{ color: "rgba(255,255,255,0.48)", fontSize: 13.5, lineHeight: 1.6, maxWidth: 620 }}>
                    {lang === "fr"
                      ? "Aperçu mocké du pilotage multi-tenant : volume d'appels, réservations, handoffs, qualité et performance par localisation."
                      : "Mock preview of multi-tenant operations: call volume, bookings, handoffs, quality, and location-level performance."}
                  </p>
                </div>

                <span style={{ border: `1px solid ${AC_BORDER}`, background: AC_DIM, color: AC_TEXT, borderRadius: 999, padding: "8px 12px", fontSize: 12, fontWeight: 700 }}>
                  {lang === "fr" ? "Preview mockée" : "Mock preview"}
                </span>
              </div>

              <div className="responsive-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
                {dashboardPreviewKpis.map((kpi) => (
                  <div key={kpi.label} style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(7,17,31,0.62)", borderRadius: 18, padding: 16 }}>
                    <p style={{ color: "rgba(255,255,255,0.38)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
                      {kpi.label}
                    </p>
                    <p style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, marginBottom: 8 }}>
                      {kpi.value}
                    </p>
                    <p style={{ color: "rgba(255,255,255,0.48)", fontSize: 12.5, lineHeight: 1.5 }}>{kpi.detail}</p>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 14 }}>
                <div style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(7,17,31,0.58)", borderRadius: 20, padding: 16, minWidth: 0 }}>
                  <h4 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 16, marginBottom: 12 }}>Calls by Tenant</h4>
                  <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
                    <table className="mobile-preview-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
                      <thead>
                        <tr>
                          <th style={{ ...previewHeadStyle, textAlign: "left" }}>Tenant</th>
                          <th style={{ ...previewHeadStyle, textAlign: "right" }}>Calls</th>
                          <th style={{ ...previewHeadStyle, textAlign: "right" }}>Bookings</th>
                          <th style={{ ...previewHeadStyle, textAlign: "right" }}>Handoff</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardTenantRows.map((row) => (
                          <tr key={row.name}>
                            <td style={{ ...previewCellStyle, color: "#f0f0ef", fontWeight: 700 }}>{row.name}</td>
                            <td style={{ ...previewCellStyle, textAlign: "right" }}>{row.calls}</td>
                            <td style={{ ...previewCellStyle, textAlign: "right" }}>{row.bookings}</td>
                            <td style={{ ...previewCellStyle, textAlign: "right", color: AC_TEXT, fontWeight: 700 }}>{row.handoffs}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(7,17,31,0.58)", borderRadius: 20, padding: 16, minWidth: 0 }}>
                  <h4 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 16, marginBottom: 12 }}>Calls by Location</h4>
                  <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
                    <table className="mobile-preview-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
                      <thead>
                        <tr>
                          <th style={{ ...previewHeadStyle, textAlign: "left" }}>Location</th>
                          <th style={{ ...previewHeadStyle, textAlign: "right" }}>Calls</th>
                          <th style={{ ...previewHeadStyle, textAlign: "right" }}>Top intent</th>
                          <th style={{ ...previewHeadStyle, textAlign: "right" }}>Quality</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardLocationRows.map((row) => (
                          <tr key={row.name}>
                            <td style={{ ...previewCellStyle, color: "#f0f0ef", fontWeight: 700 }}>{row.name}</td>
                            <td style={{ ...previewCellStyle, textAlign: "right" }}>{row.calls}</td>
                            <td style={{ ...previewCellStyle, textAlign: "right" }}>{row.topIntent}</td>
                            <td style={{ ...previewCellStyle, textAlign: "right", color: "#34D399", fontWeight: 700 }}>{row.quality}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ border: `1px solid ${AC_BORDER}`, background: "rgba(245,158,11,0.075)", borderRadius: 20, padding: 16 }}>
                  <h4 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 16, marginBottom: 12 }}>Handoffs / Quality</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {[
                      { label: "Handoff completeness", value: "98%" },
                      { label: "Intent accuracy", value: "94%" },
                      { label: "Fallback rate", value: "3.2%" },
                    ].map((item) => (
                      <div key={item.label} className="mobile-card-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(7,17,31,0.46)", borderRadius: 14, padding: "12px 13px" }}>
                        <span style={{ color: "rgba(255,255,255,0.62)", fontSize: 13 }}>{item.label}</span>
                        <span style={{ color: AC_TEXT, fontSize: 13, fontWeight: 800 }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                  <p style={{ color: "rgba(255,255,255,0.44)", fontSize: 12.5, lineHeight: 1.6, marginTop: 14 }}>
                    {lang === "fr"
                      ? "Chaque escalade conserve le résumé, la raison, le niveau de priorité et le contexte client utile."
                      : "Every escalation keeps the summary, reason, priority level, and useful guest context."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* -- IMPACT ---------------------------------------------- */}
        <section style={section}>
          <div style={container}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16 }}>
              <div style={{ ...cardBase, borderRadius: 24, padding: 28 }}>
                <SectionTitle eyebrow={lang === "fr" ? "Impact business" : "Business impact"} title={t.impactTitle} text={t.impactText} />
              </div>

              <div style={{ ...cardBase, borderRadius: 24, padding: 28 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {t.businessResults.map((item) => (
                    <div
                      key={item}
                      style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "11px 14px", fontSize: 13.5, color: "rgba(255,255,255,0.72)", transition: "border-color 150ms" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; }}
                    >
                      <span style={{ color: AC_TEXT, fontSize: 12, flexShrink: 0 }}>✓</span>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* -- USE CASES ------------------------------------------- */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Cas d'usage" : "Use cases"} title={t.useCasesTitle} text={t.useCasesText} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 32 }}>
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

        <hr style={divider} />

        {/* -- ROI ------------------------------------------------- */}
        <section style={section}>
          <div style={container}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
                gap: 18,
                alignItems: "stretch",
              }}
            >
              <div style={{ ...cardBase, borderRadius: 24, padding: "clamp(24px, 4vw, 34px)", borderColor: AC_BORDER, background: "linear-gradient(135deg, rgba(245,158,11,0.09) 0%, rgba(255,255,255,0.025) 58%, rgba(180,83,9,0.07) 100%)" }}>
                <SectionTitle eyebrow={pricingCopy.roiEyebrow} title={pricingCopy.roiTitle} text={pricingCopy.roiText} />
              </div>
              <div style={{ ...cardBase, borderRadius: 24, padding: "clamp(22px, 3vw, 30px)", background: "rgba(11,22,40,0.58)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  {[
                    { label: lang === "fr" ? "Réponse" : "Response", value: "Instant" },
                    { label: lang === "fr" ? "Réservations" : "Bookings", value: "Captured" },
                    { label: lang === "fr" ? "Relances" : "Follow-up", value: "Auto" },
                    { label: lang === "fr" ? "Revenus" : "Revenue", value: "Tracked" },
                  ].map((item) => (
                    <div key={item.label} style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.035)", borderRadius: 16, padding: "16px 14px" }}>
                      <p style={{ color: "rgba(255,255,255,0.36)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                        {item.label}
                      </p>
                      <p style={{ color: AC_TEXT, fontFamily: "'Syne', sans-serif", fontSize: "clamp(1.15rem, 2vw, 1.5rem)", fontWeight: 800, letterSpacing: "-0.025em" }}>
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* -- PRICING --------------------------------------------- */}
        <section id="pricing" style={section}>
          <div style={container}>
            <SectionTitle eyebrow={pricingCopy.pricingEyebrow} title={pricingCopy.pricingTitle} text={pricingCopy.pricingText} />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16, marginTop: 32, alignItems: "stretch" }}>
              {pricingCopy.plans.map((plan) => (
                <div
                  key={plan.name}
                  style={{
                    ...cardBase,
                    borderRadius: 26,
                    padding: "clamp(20px, 3vw, 26px)",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: "100%",
                    borderColor: plan.featured ? AC_BORDER : "rgba(255,255,255,0.08)",
                    background: plan.featured
                      ? "linear-gradient(180deg, rgba(245,158,11,0.14) 0%, rgba(255,255,255,0.035) 42%, rgba(11,22,40,0.72) 100%)"
                      : "rgba(255,255,255,0.03)",
                    boxShadow: plan.featured ? "0 26px 90px rgba(0,0,0,0.30)" : "none",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER;
                    (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = plan.featured ? AC_BORDER : "rgba(255,255,255,0.08)";
                    (e.currentTarget as HTMLElement).style.transform = "none";
                  }}
                >
                  {plan.featured && (
                    <span style={{ position: "absolute", top: 18, right: 18, border: `1px solid ${AC_BORDER}`, background: AC_DIM, color: AC_TEXT, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 800 }}>
                      {pricingCopy.popularBadge}
                    </span>
                  )}

                  <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: plan.featured ? AC_TEXT : "rgba(255,255,255,0.42)", marginBottom: 12 }}>
                    {plan.name}
                  </p>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: 8 }}>
                    <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "clamp(2rem, 4vw, 2.75rem)", lineHeight: 1, fontWeight: 800, letterSpacing: "-0.04em", color: "#f0f0ef" }}>
                      {plan.price}
                    </span>
                    <span style={{ color: "rgba(255,255,255,0.48)", fontSize: 13 }}>{plan.suffix}</span>
                  </div>
                  <p style={{ color: AC_TEXT, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
                    {pricingCopy.setupLabel} {plan.setup}
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.58)", fontSize: 14, lineHeight: 1.6, minHeight: 45, marginBottom: 20 }}>
                    {plan.positioning}
                  </p>

                  <Link
                    href="/contact"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "100%",
                      padding: "13px 18px",
                      background: plan.featured ? AC : AC_DIM,
                      color: plan.featured ? "#160b02" : AC_TEXT,
                      fontSize: 14,
                      fontWeight: 800,
                      borderRadius: 999,
                      textDecoration: "none",
                      border: `1px solid ${plan.featured ? AC : AC_BORDER}`,
                      boxShadow: plan.featured ? `0 5px 26px ${AC_SHADOW}` : "none",
                      marginBottom: 22,
                    }}
                  >
                    {plan.cta}
                  </Link>

                  <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.34)", marginBottom: 12 }}>
                    {pricingCopy.includedLabel}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {plan.features.map((feature) => (
                      <div key={feature} style={{ display: "flex", gap: 9, alignItems: "flex-start", color: "rgba(255,255,255,0.68)", fontSize: 13, lineHeight: 1.45 }}>
                        <span style={{ color: AC_TEXT, flexShrink: 0, fontSize: 12, lineHeight: 1.45 }}>✓</span>
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p style={{ color: "rgba(255,255,255,0.44)", fontSize: 13, lineHeight: 1.6, marginTop: 18 }}>
              {pricingCopy.note}
            </p>

            <div style={{ marginTop: 34 }}>
              <SectionTitle eyebrow="Comparison" title={pricingCopy.comparisonTitle} text={pricingCopy.comparisonText} />
              <div style={{ marginTop: 20, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, background: "rgba(255,255,255,0.025)", overflow: "hidden" }}>
                <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                    <thead>
                      <tr>
                        {["Feature", "Growth", "Pro", "Premium"].map((heading) => (
                          <th
                            key={heading}
                            style={{
                              padding: "15px 16px",
                              borderBottom: "1px solid rgba(255,255,255,0.08)",
                              background: heading === "Pro" ? "rgba(245,158,11,0.10)" : "rgba(7,17,31,0.58)",
                              color: heading === "Pro" ? AC_TEXT : "rgba(255,255,255,0.58)",
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 10,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              textAlign: heading === "Feature" ? "left" : "center",
                            }}
                          >
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((row) => (
                        <tr key={row.feature}>
                          <td style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "#f0f0ef", fontSize: 13.5, fontWeight: 700 }}>
                            {row.feature}
                          </td>
                          {[
                            { key: "growth", value: row.growth },
                            { key: "pro", value: row.pro },
                            { key: "premium", value: row.premium },
                          ].map((cell) => (
                            <td
                              key={cell.key}
                              style={{
                                padding: "14px 16px",
                                borderBottom: "1px solid rgba(255,255,255,0.06)",
                                background: cell.key === "pro" ? "rgba(245,158,11,0.055)" : "transparent",
                                color: cell.value === "No" ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.68)",
                                fontSize: 13,
                                textAlign: "center",
                                whiteSpace: "normal",
                              }}
                            >
                              {cell.value}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* -- CTA FINAL ------------------------------------------- */}
        <section style={{ ...section, paddingTop: 0 }}>
          <div style={container}>
            <div
              className="responsive-cta-card"
              style={{
                background: "linear-gradient(135deg, rgba(245,158,11,0.10) 0%, rgba(255,255,255,0.02) 50%, rgba(180,83,9,0.08) 100%)",
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
              <p className="responsive-body-copy" style={{ fontSize: 15, color: "rgba(255,255,255,0.54)", lineHeight: 1.7, maxWidth: 620, margin: "0 auto 28px" }}>
                {t.ctaText}
              </p>
              <div className="responsive-cta-actions" style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
                <CallTestButton shadow="0 6px 28px">
                  {t.testCta}
                </CallTestButton>
                <ClientLoginButton>
                  {t.clientLoginCta}
                </ClientLoginButton>
                <Link
                  href="/contact"
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 26px", background: "rgba(255,255,255,0.08)", color: "#f0f0ef", fontSize: 14, fontWeight: 600, borderRadius: 999, textDecoration: "none", border: "1px solid rgba(255,255,255,0.16)", transition: "background 150ms" }}
                >
                  {t.ctaPrimary}
                </Link>
                <Link
                  href="/"
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 26px", background: "rgba(255,255,255,0.08)", color: "#f0f0ef", fontSize: 14, fontWeight: 600, borderRadius: 999, textDecoration: "none", border: "1px solid rgba(255,255,255,0.16)", transition: "background 150ms" }}
                >
                  {t.ctaSecondary}
                </Link>
              </div>
            </div>
          </div>
        </section>

      </main>
    </NavbarFooter>
  );
}
