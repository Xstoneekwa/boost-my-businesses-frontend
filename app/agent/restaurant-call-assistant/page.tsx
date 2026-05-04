"use client";

import Link from "next/link";
import Image from "next/image";
import Script from "next/script";
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
    badge: "Assistant IA Restaurant",
    heroTitle: "Un assistant IA qui répond aux appels, capture les réservations et protège ton équipe.",
    heroSubtitle: "Ne rate plus aucun appel. Ne perds plus aucune réservation.",
    testCta: "Tester l'outil",
    clientLoginCta: "Accès tableau de bord",
    getStartedCta: "Commencer",
    contactCta: "Réserver une démo / Nous contacter",
    stats: [
      { label: "Disponibilité", value: "24/7" },
      { label: "Couverture", value: "Appels • Réservations • FAQ" },
      { label: "Pilotage", value: "Par restaurant & site" },
    ],
    productBoxTitle: "Expérience d'appel",
    productSteps: [
      { label: "Le client appelle", text: "Réservation, modification ou question." },
      { label: "L'IA traite la demande", text: "Intention, détails utiles et réponse claire." },
      { label: "Action créée", text: "Réservation ou escalade transmise à l'équipe." },
    ],
    problemTitle: "Le problème que ce système résout",
    problemText:
      "Les restaurants perdent des réservations quand les appels arrivent en plein service, après les heures d'ouverture ou quand l'équipe est déjà occupée.",
    problems: [
      "Appels manqués pendant les pics de service",
      "Réservations perdues ou mal qualifiées",
      "Équipe constamment interrompue",
      "Gestion fragile des demandes complexes",
    ],
    solutionTitle: "La solution",
    solutionText:
      "L'IA gère les appels, capture les réservations, répond aux questions fréquentes et escalade seulement quand c'est nécessaire.",
    solutions: [
      "Réponse automatique aux appels entrants, même hors horaires",
      "Capture des réservations avec les bons détails opérationnels",
      "Réponses aux questions fréquentes : horaires, menu, parking, allergies, privatisations",
      "Routage intelligent vers réservation, FAQ, modification, annulation ou escalade",
    ],
    useCasesTitle: "Cas d'usage",
    useCasesText: "Quatre environnements où les appels doivent être gérés vite, clairement et sans interrompre le service.",
    useCases: [
      { title: "Restaurants premium", items: ["Réservations", "Demandes VIP", "Allergies", "Anniversaires"] },
      { title: "Groupes multi-sites", items: ["Vue par site", "Comparaison des escalades", "Pilotage centralisé"] },
      { title: "Concepts à fort volume", items: ["Rush du soir", "Takeaway", "Modifications de réservation"] },
      { title: "Hospitality", items: ["Rooftops", "Bars à cocktails", "Beach clubs", "Private dining"] },
    ],
    differenceTitle: "Ce qui le rend différent",
    differenceText: "Un système pensé pour les vraies opérations restaurant, pas seulement pour répondre au téléphone.",
    differentiators: [
      { title: "Fonctionne par localisation", text: "Vue claire par restaurant, groupe et site." },
      { title: "Mémorise le contexte utile", text: "Préférences, allergies, demandes récurrentes et notes importantes." },
      { title: "Route chaque appel correctement", text: "Réservation, FAQ, modification, annulation ou urgence." },
      { title: "Conçu pour les opérations", text: "Escalades propres, suivi clair et logique utilisable par l'équipe." },
    ],
    workflowTitle: "Comment ça marche",
    workflowText: "Une expérience simple côté client, avec le bon suivi côté équipe.",
    flowSteps: [
      "Le client appelle",
      "L'IA comprend l'intention",
      "La réservation ou la réponse est traitée",
      "Un humain reprend si nécessaire",
    ],
    featuresTitle: "Fonctionnalités",
    featuresText: "Six briques compactes pour couvrir les appels du quotidien et les cas sensibles.",
    features: [
      "Gestion des appels",
      "Automatisation des réservations",
      "Mémoire client",
      "Système d'escalade",
      "Analyses & rapports",
      "Intégrations",
    ],
    analyticsTitle: "Vue temps réel de ta performance",
    analyticsText:
      "Vois les appels, réservations, escalades, relances et revenus récupérés par restaurant et localisation.",
    analytics: [
      { label: "Appels traités", value: "1,284", text: "Volume suivi par période." },
      { label: "Réservations", value: "412", text: "Demandes capturées ou qualifiées." },
      { label: "Escalades", value: "7.8%", text: "Transmises avec contexte." },
      { label: "Intention clé", value: "Réservation", text: "Motif principal par site." },
    ],
    calendlyTitle: "Réserve une démo en 30 secondes",
    calendlyText: "Découvre combien de réservations ton restaurant perd.",
    trustBadge: "Systèmes testés en conditions réelles",
    trustTitle: "Ils nous font confiance pour gérer leurs opérations",
    trustText:
      "De la restauration au conseil en passant par les ONG, nos systèmes IA et automatisations sont déjà utilisés dans des environnements exigeants.",
    testimonials: [
      {
        company: "In de Patattezak bij Pee Klak",
        category: "Restaurant",
        logo: "/logos/patattezak.png",
        initials: "IP",
        quote:
          "Nous avons utilisé le système pour mieux gérer les demandes pendant les périodes de rush. Cela réduit les opportunités perdues et fluidifie le service.",
      },
      {
        company: "DMT Consulting",
        category: "Conseil en ingénierie",
        description: "Fournisseur reconnu de solutions d'ingénierie innovantes et durables.",
        logo: "/logos/dmt-consulting.png",
        initials: "DMT",
        quote:
          "Nous avons déployé plusieurs automatisations avec Boost My Businesses. L'architecture est fiable, flexible et pensée pour un usage réel.",
      },
      {
        company: "Save Animals",
        category: "ONG de protection animale",
        logo: "/logos/save-animals.png",
        initials: "SA",
        quote:
          "Nous avons adapté une version personnalisée du système à nos besoins. Cela nous a permis de gérer les demandes plus efficacement sans alourdir la charge de travail.",
      },
    ],
    ctaEyebrow: "Prochaine étape",
    ctaTitle: "Prêt à arrêter de perdre des réservations ?",
    ctaText: "Teste l'assistant IA Restaurant et vois combien d'appels ton équipe peut récupérer.",
  },
  en: {
    badge: "AI Restaurant Call Assistant",
    heroTitle: "An AI assistant that answers calls, captures bookings, and protects your team.",
    heroSubtitle: "Never miss a call. Never lose a booking.",
    testCta: "Test the tool",
    clientLoginCta: "Dashboard access",
    getStartedCta: "Get started",
    contactCta: "Book a demo / Contact us",
    stats: [
      { label: "Availability", value: "24/7" },
      { label: "Coverage", value: "Calls • Booking • FAQ" },
      { label: "Visibility", value: "By restaurant & location" },
    ],
    productBoxTitle: "Call experience",
    productSteps: [
      { label: "Guest calls", text: "Booking, change, or question." },
      { label: "AI handles the request", text: "Intent, useful details, and clear response." },
      { label: "Action created", text: "Booking or escalation reaches the team." },
    ],
    problemTitle: "The problem this system solves",
    problemText:
      "Restaurants lose bookings when calls arrive during rush, after hours, or when the team is already busy.",
    problems: [
      "Missed calls during service peaks",
      "Lost or poorly qualified bookings",
      "Constant interruptions for front-of-house staff",
      "Fragile handling of complex requests",
    ],
    solutionTitle: "The solution",
    solutionText: "AI handles calls, captures bookings, answers common questions, and escalates only when needed.",
    solutions: [
      "Automatic call handling, including after-hours coverage",
      "Booking capture with the right operational details",
      "Answers for common questions: opening hours, menu, parking, allergies, private dining",
      "Smart routing across booking, FAQ, modification, cancellation, or escalation",
    ],
    useCasesTitle: "Use cases",
    useCasesText: "Four environments where calls need to be handled quickly, clearly, and without interrupting service.",
    useCases: [
      { title: "Premium restaurants", items: ["Bookings", "VIP requests", "Allergies", "Birthdays"] },
      { title: "Multi-location groups", items: ["Location view", "Handoff comparison", "Centralized operations"] },
      { title: "High-volume concepts", items: ["Dinner rush", "Takeaway", "Booking modifications"] },
      { title: "Hospitality", items: ["Rooftops", "Cocktail bars", "Beach clubs", "Private dining"] },
    ],
    differenceTitle: "What makes it different",
    differenceText: "Built for real restaurant operations, not just answering the phone.",
    differentiators: [
      { title: "Works across locations", text: "Clear visibility by restaurant, group, and site." },
      { title: "Remembers useful customer context", text: "Preferences, allergies, repeat requests, and important notes." },
      { title: "Routes every call correctly", text: "Booking, FAQ, modification, cancellation, or urgent issue." },
      { title: "Built for real operations", text: "Clean handoffs, clear tracking, and logic your team can use." },
    ],
    workflowTitle: "How it works",
    workflowText: "A simple guest experience with the right operational follow-through.",
    flowSteps: [
      "Guest calls",
      "AI understands intent",
      "Booking or answer is handled",
      "Human takeover if needed",
    ],
    featuresTitle: "Features",
    featuresText: "Six compact categories covering daily calls and sensitive cases.",
    features: [
      "Call handling",
      "Booking automation",
      "Customer memory",
      "Escalation system",
      "Analytics & reporting",
      "Integrations",
    ],
    analyticsTitle: "Real-time view of your performance",
    analyticsText:
      "See calls, bookings, escalations, follow-ups, and recovered revenue by restaurant and location.",
    analytics: [
      { label: "Calls handled", value: "1,284", text: "Volume tracked by period." },
      { label: "Bookings", value: "412", text: "Requests captured or qualified." },
      { label: "Escalations", value: "7.8%", text: "Transferred with context." },
      { label: "Top intent", value: "Booking", text: "Main reason by site." },
    ],
    calendlyTitle: "Book a demo in 30 seconds",
    calendlyText: "See how many bookings your restaurant is missing.",
    trustBadge: "Production-tested systems",
    trustTitle: "They trust us to handle their operations",
    trustText:
      "From restaurants to consulting and non-profits, our AI and automation systems are already used in demanding environments.",
    testimonials: [
      {
        company: "In de Patattezak bij Pee Klak",
        category: "Restaurant",
        logo: "/logos/patattezak.png",
        initials: "IP",
        quote:
          "We used the system to better handle incoming requests during busy periods. It helps reduce missed opportunities and keeps operations smooth.",
      },
      {
        company: "DMT Consulting",
        category: "Engineering consulting",
        description: "Trusted provider of innovative and sustainable engineering solutions.",
        logo: "/logos/dmt-consulting.png",
        initials: "DMT",
        quote:
          "We've implemented several automation systems from Boost My Businesses. The architecture is reliable, flexible, and built for real-world usage.",
      },
      {
        company: "Save Animals",
        category: "Animal protection NGO",
        logo: "/logos/save-animals.png",
        initials: "SA",
        quote:
          "We adapted a custom version of the automation system to fit our needs. It helped us manage requests more efficiently without increasing workload.",
      },
    ],
    ctaEyebrow: "Next step",
    ctaTitle: "Ready to stop losing bookings?",
    ctaText: "Test the AI Restaurant Call Assistant and see how many calls your team can recover.",
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
          border: `1px solid ${AC_BORDER}`,
          background: AC_DIM,
          color: AC_TEXT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Syne', sans-serif",
          fontSize: 17,
          fontWeight: 800,
          letterSpacing: "0.02em",
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

const cardBase: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: "20px 18px",
  transition: "border-color 200ms, transform 200ms",
};

export default function RestaurantCallAssistantPage() {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    const saved = window.localStorage.getItem(LANG_KEY) as Lang | null;
    return saved === "fr" || saved === "en" ? saved : "en";
  });

  useEffect(() => {
    persistRestaurantLang(lang);
  }, [lang]);

  const t = copy[lang];

  const section: React.CSSProperties = { padding: "clamp(42px, 7vw, 64px) 0" };
  const container: React.CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: "0 clamp(16px, 3vw, 24px)" };
  const divider: React.CSSProperties = { border: "none", borderTop: "1px solid rgba(255,255,255,0.06)", margin: 0 };
  const fourCardGrid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))",
    gap: 14,
    marginTop: 30,
  };
  const dashboardPreviewKpis = [
    { label: lang === "fr" ? "Appels totaux" : "Total Calls", value: "1,284", detail: lang === "fr" ? "Appels entrants traités" : "Inbound calls handled" },
    { label: lang === "fr" ? "Réservations" : "Bookings", value: "412", detail: lang === "fr" ? "Réservations capturées" : "Bookings captured" },
    { label: lang === "fr" ? "Traités par l'IA" : "Auto Handled", value: "86%", detail: lang === "fr" ? "Résolus sans intervention" : "Resolved without staff" },
    { label: lang === "fr" ? "Escalades" : "Handoffs", value: "7.8%", detail: lang === "fr" ? "Escalades humaines" : "Human escalations" },
  ];
  const dashboardTenantRows = [
    { name: lang === "fr" ? "Groupe A" : "Group A", calls: "684", bookings: "218", handoffs: "6.1%" },
    { name: lang === "fr" ? "Groupe B" : "Group B", calls: "438", bookings: "151", handoffs: "4.8%" },
    { name: lang === "fr" ? "Groupe C" : "Group C", calls: "392", bookings: "126", handoffs: "8.3%" },
  ];
  const dashboardLocationRows = [
    { name: lang === "fr" ? "Site A" : "Location A", calls: "512", topIntent: "Booking", quality: "94%" },
    { name: lang === "fr" ? "Site B" : "Location B", calls: "467", topIntent: "FAQ", quality: "91%" },
    { name: lang === "fr" ? "Site C" : "Location C", calls: "389", topIntent: "Private dining", quality: "88%" },
  ];
  const pricingCopy =
    lang === "fr"
      ? {
          roiEyebrow: "ROI",
          roiTitle: "Pas seulement un assistant d'appel. Un système de récupération de revenus.",
          roiText: "Chaque appel manqué = revenu perdu.",
          pricingEyebrow: "Offres",
          pricingTitle: "Choisis le niveau adapté à ton volume d'appels",
          pricingText:
            "Démarre simplement, puis évolue vers les relances, analyses, intégrations et opérations multi-sites.",
          setupLabel: "Frais d'installation",
          includedLabel: "Inclus",
          popularBadge: "Le plus choisi",
          note: "Les plans peuvent être adaptés selon le volume d'appels, le nombre de sites et les intégrations nécessaires.",
          comparisonTitle: "Comparaison des plans",
          comparisonText: "Une vue simple des capacités clés incluses dans chaque package.",
          plans: [
            {
              name: "Growth",
              price: "€299",
              suffix: "/mois",
              setup: "€800",
              positioning: "Pour les restaurants indépendants sérieux.",
              cta: "Commencer avec Growth",
              featured: false,
              features: [
                "300 appels/mois",
                "Gestion simple des réservations",
                "Réponses FAQ de base",
                "Confirmation SMS pour les clients",
                "Escalade intelligente vers l'équipe",
                "Tableau de bord : appels vers réservations récupérées",
                "Mise à jour CRM automatique",
                "Script standard optimisé",
              ],
            },
            {
              name: "Pro",
              price: "€599",
              suffix: "/mois",
              setup: "€1200",
              positioning: "Pour les restaurants occupés avec un fort volume d'appels.",
              cta: "Choisir Pro",
              featured: true,
              features: [
                "Tout Growth",
                "1000 appels/mois",
                "Traitement prioritaire VIP et groupes",
                "Relances WhatsApp + SMS automatiques",
                "Escalade avancée pour les cas complexes",
                "Analyses avancées et revenu récupéré",
                "Script restaurant personnalisé",
                "Optimisation mensuelle du script",
                "Support prioritaire",
              ],
            },
            {
              name: "Premium",
              price: "€999+",
              suffix: "/mois",
              setup: "€1500+",
              positioning: "Pour les chaînes et restaurants multi-sites.",
              cta: "Réserver une démo Premium",
              featured: false,
              features: [
                "Tout Pro",
                "3000 appels/mois",
                "Support multi-sites",
                "Flows IA personnalisés pour cas spécifiques",
                "Intégrations avancées réservation, CRM et outils internes",
                "Reporting personnalisé",
                "Suivi et optimisation mensuels",
                "Support dédié",
              ],
            },
          ],
        }
      : {
          roiEyebrow: "ROI",
          roiTitle: "Not just a call assistant. A revenue recovery system.",
          roiText: "Every missed call = lost revenue.",
          pricingEyebrow: "Packages",
          pricingTitle: "Choose the level that matches your call volume",
          pricingText:
            "Start simple, then scale into follow-ups, analytics, integrations, and multi-location operations.",
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
  const yes = lang === "fr" ? "Oui" : "Yes";
  const no = lang === "fr" ? "Non" : "No";
  const comparisonRows = lang === "fr"
    ? [
        { feature: "Appels mensuels", growth: "300", pro: "1000", premium: "3000" },
        { feature: "Gestion des réservations", growth: yes, pro: yes, premium: yes },
        { feature: "FAQ de base", growth: yes, pro: yes, premium: yes },
        { feature: "Confirmation SMS", growth: yes, pro: yes, premium: yes },
        { feature: "Relance WhatsApp + SMS", growth: no, pro: yes, premium: yes },
        { feature: "Escalade intelligente", growth: yes, pro: yes, premium: yes },
        { feature: "Escalade avancée", growth: no, pro: yes, premium: yes },
        { feature: "Mise à jour CRM", growth: yes, pro: yes, premium: yes },
        { feature: "Tableau de bord", growth: "Basique", pro: "Avancé", premium: "Avancé + personnalisé" },
        { feature: "Analyses avancées", growth: no, pro: yes, premium: yes },
        { feature: "Multi-sites", growth: no, pro: no, premium: yes },
        { feature: "Flows IA personnalisés", growth: no, pro: no, premium: yes },
        { feature: "Intégrations avancées", growth: no, pro: no, premium: yes },
        { feature: "Reporting personnalisé", growth: no, pro: no, premium: yes },
        { feature: "Niveau de support", growth: "Standard", pro: "Prioritaire", premium: "Dédié" },
      ]
    : [
        { feature: "Monthly calls", growth: "300", pro: "1000", premium: "3000" },
        { feature: "Reservation handling", growth: yes, pro: yes, premium: yes },
        { feature: "Basic FAQ", growth: yes, pro: yes, premium: yes },
        { feature: "SMS confirmation", growth: yes, pro: yes, premium: yes },
        { feature: "WhatsApp + SMS follow-up", growth: no, pro: yes, premium: yes },
        { feature: "Smart escalation", growth: yes, pro: yes, premium: yes },
        { feature: "Advanced escalation", growth: no, pro: yes, premium: yes },
        { feature: "CRM update", growth: yes, pro: yes, premium: yes },
        { feature: "Basic dashboard", growth: "Basic", pro: "Advanced", premium: "Advanced + custom" },
        { feature: "Advanced analytics", growth: no, pro: yes, premium: yes },
        { feature: "Multi-location", growth: no, pro: no, premium: yes },
        { feature: "Custom AI flows", growth: no, pro: no, premium: yes },
        { feature: "Advanced integrations", growth: no, pro: no, premium: yes },
        { feature: "Custom reporting", growth: no, pro: no, premium: yes },
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

                <div className="responsive-hero-actions" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 32 }}>
                  <CallTestButton>
                    {t.testCta}
                  </CallTestButton>

                  <ClientLoginButton>
                    {t.clientLoginCta}
                  </ClientLoginButton>
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
            <div style={fourCardGrid}>
              {t.problems.map((item) => (
                <div
                  key={item}
                  style={{ ...cardBase, minHeight: 136 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.30)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 8px rgba(239,68,68,0.5)", marginBottom: 14 }} />
                  <p style={{ fontSize: 15.5, fontWeight: 500, color: "rgba(255,255,255,0.82)", lineHeight: 1.5 }}>{item}</p>
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
            <div style={fourCardGrid}>
              {t.solutions.map((item, index) => (
                <div
                  key={item}
                  style={{ ...cardBase, minHeight: 172 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: AC_DIM, border: `1px solid ${AC_BORDER}`, color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                    {index + 1}
                  </div>
                  <p style={{ fontSize: 15, color: "rgba(255,255,255,0.76)", lineHeight: 1.58 }}>{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* -- USE CASES ------------------------------------------- */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Cas d'usage" : "Use cases"} title={t.useCasesTitle} text={t.useCasesText} />
            <div style={fourCardGrid}>
              {t.useCases.map((useCase) => (
                <div
                  key={useCase.title}
                  style={{ ...cardBase, minHeight: 150 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700, color: "#f0f0ef", lineHeight: 1.25, marginBottom: 14 }}>
                    {useCase.title}
                  </h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {useCase.items.map((item) => (
                      <span key={item} style={{ padding: "5px 11px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", fontSize: 12.5, color: "rgba(255,255,255,0.68)", lineHeight: 1.3 }}>
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

        {/* -- DASHBOARD PREVIEW ----------------------------------- */}
        <section style={section}>
          <div style={container}>
            <SectionTitle
              eyebrow={lang === "fr" ? "Tableau de bord / analyses" : "Dashboard / analytics"}
              title={t.analyticsTitle}
              text={t.analyticsText}
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
                    {lang === "fr" ? "Assistant IA Restaurant" : "AI Restaurant Call Assistant"}
                  </p>
                  <h3 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: "clamp(1.25rem, 2vw, 1.8rem)", letterSpacing: "-0.025em", marginBottom: 6 }}>
                    {lang === "fr" ? "Vue d'analyse restaurant" : "Restaurant Analytics Overview"}
                  </h3>
                  <p style={{ color: "rgba(255,255,255,0.48)", fontSize: 13.5, lineHeight: 1.6, maxWidth: 620 }}>
                    {lang === "fr"
                      ? "Aperçu de démonstration : appels, réservations, escalades, qualité et performance par site."
                      : "Mock preview of multi-tenant operations: call volume, bookings, handoffs, quality, and location-level performance."}
                  </p>
                </div>

                <span style={{ border: `1px solid ${AC_BORDER}`, background: AC_DIM, color: AC_TEXT, borderRadius: 999, padding: "8px 12px", fontSize: 12, fontWeight: 700 }}>
                  {lang === "fr" ? "Aperçu de démonstration" : "Mock preview"}
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
                  <h4 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 16, marginBottom: 12 }}>
                    {lang === "fr" ? "Appels par groupe" : "Calls by Tenant"}
                  </h4>
                  <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
                    <table className="mobile-preview-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
                      <thead>
                        <tr>
                          <th style={{ ...previewHeadStyle, textAlign: "left" }}>{lang === "fr" ? "Groupe" : "Tenant"}</th>
                          <th style={{ ...previewHeadStyle, textAlign: "right" }}>{lang === "fr" ? "Appels" : "Calls"}</th>
                          <th style={{ ...previewHeadStyle, textAlign: "right" }}>{lang === "fr" ? "Réservations" : "Bookings"}</th>
                          <th style={{ ...previewHeadStyle, textAlign: "right" }}>{lang === "fr" ? "Escalade" : "Handoff"}</th>
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
                  <h4 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 16, marginBottom: 12 }}>
                    {lang === "fr" ? "Appels par site" : "Calls by Location"}
                  </h4>
                  <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
                    <table className="mobile-preview-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
                      <thead>
                        <tr>
                          <th style={{ ...previewHeadStyle, textAlign: "left" }}>{lang === "fr" ? "Site" : "Location"}</th>
                          <th style={{ ...previewHeadStyle, textAlign: "right" }}>{lang === "fr" ? "Appels" : "Calls"}</th>
                          <th style={{ ...previewHeadStyle, textAlign: "right" }}>{lang === "fr" ? "Intention clé" : "Top intent"}</th>
                          <th style={{ ...previewHeadStyle, textAlign: "right" }}>{lang === "fr" ? "Qualité" : "Quality"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardLocationRows.map((row) => (
                          <tr key={row.name}>
                            <td style={{ ...previewCellStyle, color: "#f0f0ef", fontWeight: 700 }}>{row.name}</td>
                            <td style={{ ...previewCellStyle, textAlign: "right" }}>{row.calls}</td>
                            <td style={{ ...previewCellStyle, textAlign: "right" }}>
                              {lang === "fr" && row.topIntent === "Booking" ? "Réservation" : lang === "fr" && row.topIntent === "Private dining" ? "Privatisation" : row.topIntent}
                            </td>
                            <td style={{ ...previewCellStyle, textAlign: "right", color: "#34D399", fontWeight: 700 }}>{row.quality}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ border: `1px solid ${AC_BORDER}`, background: "rgba(245,158,11,0.075)", borderRadius: 20, padding: 16 }}>
                  <h4 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 16, marginBottom: 12 }}>
                    {lang === "fr" ? "Escalades / qualité" : "Handoffs / Quality"}
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {[
                      { label: lang === "fr" ? "Escalade complète" : "Handoff completeness", value: "98%" },
                      { label: lang === "fr" ? "Précision d'intention" : "Intent accuracy", value: "94%" },
                      { label: lang === "fr" ? "Taux de fallback" : "Fallback rate", value: "3.2%" },
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
                  {(lang === "fr"
                    ? ["Réponse instantanée", "Réservations capturées", "Relances automatisées", "Revenus suivis"]
                    : ["Instant response", "Bookings captured", "Follow-ups automated", "Revenue tracked"]
                  ).map((item) => (
                    <div key={item} style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.035)", borderRadius: 16, padding: "16px 14px" }}>
                      <p style={{ color: AC_TEXT, fontFamily: "'Syne', sans-serif", fontSize: "clamp(1rem, 1.8vw, 1.25rem)", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.25 }}>
                        {item}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* -- TRUSTED OPERATIONS ---------------------------------- */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={t.trustBadge} title={t.trustTitle} text={t.trustText} />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
                gap: 16,
                marginTop: 32,
                alignItems: "stretch",
              }}
            >
              {t.testimonials.map((item) => (
                <article
                  key={item.company}
                  style={{
                    ...cardBase,
                    borderRadius: 24,
                    padding: "clamp(16px, 2.2vw, 18px)",
                    minHeight: 256,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.026) 100%)",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  <div>
                    <TestimonialLogo src={item.logo} alt={`${item.company} logo`} initials={item.initials} />
                    <div style={{ marginTop: 12 }}>
                      <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 17, fontWeight: 800, color: "#f0f0ef", lineHeight: 1.2, marginBottom: 5 }}>
                        {item.company}
                      </h3>
                      <p style={{ color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", lineHeight: 1.35 }}>
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
          </div>
        </section>

        <hr style={divider} />

        {/* -- CALENDLY --------------------------------------------- */}
        <section style={section}>
          <div style={{ ...container, maxWidth: 900 }}>
            <div style={{ textAlign: "center", margin: "0 auto 28px", maxWidth: 680 }}>
              <h2
                style={{
                  fontFamily: "'Syne', sans-serif",
                  fontSize: "clamp(1.5rem, 2.6vw, 2.15rem)",
                  fontWeight: 800,
                  letterSpacing: "-0.025em",
                  color: "#f0f0ef",
                  lineHeight: 1.12,
                  marginBottom: 10,
                }}
              >
                {t.calendlyTitle}
              </h2>
              <p style={{ fontSize: 15.5, color: "rgba(255,255,255,0.54)", lineHeight: 1.65 }}>
                {t.calendlyText}
              </p>
            </div>

            <div
              style={{
                border: `1px solid ${AC_BORDER}`,
                background: "linear-gradient(135deg, rgba(245,158,11,0.07) 0%, rgba(255,255,255,0.025) 48%, rgba(11,22,40,0.72) 100%)",
                borderRadius: 28,
                padding: "clamp(10px, 2vw, 16px)",
                boxShadow: "0 26px 80px rgba(0,0,0,0.24)",
                overflow: "hidden",
              }}
            >
              <Script
                src="https://assets.calendly.com/assets/external/widget.js"
                strategy="lazyOnload"
              />
              <div
                className="calendly-inline-widget restaurant-calendly-frame"
                data-url="https://calendly.com/boostmybusinesses/discovertheassistant"
                style={{ minWidth: "320px", height: "700px" }}
              />
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* -- PRICING --------------------------------------------- */}
        <section id="pricing" className="scroll-mt-28" style={{ ...section, scrollMarginTop: 112 }}>
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
              <SectionTitle eyebrow={lang === "fr" ? "Comparaison" : "Comparison"} title={pricingCopy.comparisonTitle} text={pricingCopy.comparisonText} />
              <div style={{ marginTop: 20, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, background: "rgba(255,255,255,0.025)", overflow: "hidden" }}>
                <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                    <thead>
                      <tr>
                        {[
                          lang === "fr" ? "Fonction" : "Feature",
                          "Growth",
                          "Pro",
                          "Premium",
                        ].map((heading) => (
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
                              textAlign: heading === (lang === "fr" ? "Fonction" : "Feature") ? "left" : "center",
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
                                color: cell.value === no ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.68)",
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
              <div className="responsive-cta-actions" style={{ display: "flex", justifyContent: "center" }}>
                <Link
                  href={CALL_TEST_HREF}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "16px 34px",
                    background: AC,
                    color: "#160b02",
                    fontSize: 15.5,
                    fontWeight: 800,
                    borderRadius: 999,
                    textDecoration: "none",
                    boxShadow: `0 8px 34px ${AC_SHADOW}`,
                    transition: "opacity 150ms, transform 150ms",
                  }}
                >
                  {t.testCta}
                </Link>
              </div>
            </div>
          </div>
        </section>

      </main>
    </NavbarFooter>
  );
}
