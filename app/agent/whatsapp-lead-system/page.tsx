"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

type Lang = "fr" | "en";

const LANG_KEY = "whatsapp_ai_system_lang_v1";

const copy = {
  fr: {
    badge: "Automatisation WhatsApp IA",
    heroTitle:
      "Des leads WhatsApp gérés automatiquement, qualifiés instantanément et transférés au bon moment.",
    heroSubtitle:
      "Ce système IA répond aux prospects 24h/24, détecte l’intention, pousse à la réservation et escalade les cas urgents vers ton équipe via Slack.",
    primaryCta: "Ouvrir la démo visuelle",
    secondaryCta: "Retour à l’accueil",
    stats: [
      { label: "Disponibilité", value: "24/7" },
      { label: "Actions clés", value: "FAQ • Booking • Urgence" },
      { label: "Escalade", value: "Slack handoff" },
    ],
    productBoxTitle: "Ce que fait le système",
    productSteps: [
      {
        label: "Message entrant",
        text: "“Je veux prendre rendez-vous”",
      },
      {
        label: "Détection IA",
        text: "L’intention de réservation est détectée instantanément",
      },
      {
        label: "Réponse automatique",
        text: "Le lien de réservation est envoyé automatiquement",
      },
      {
        label: "Fallback urgence",
        text: "Les cas critiques déclenchent une alerte Slack pour l’équipe",
      },
    ],
    problemTitle: "Le problème que ce système résout",
    problemText:
      "Beaucoup d’entreprises perdent des leads sur WhatsApp parce que les réponses arrivent trop tard, que l’équipe est débordée et qu’aucun suivi structuré n’existe.",
    problems: [
      "Réponses trop lentes",
      "Équipe surchargée",
      "Pas de suivi structuré",
    ],
    solutionTitle: "La solution",
    solutionText:
      "Ce workflow automatise l’ensemble du parcours lead, du premier message jusqu’à l’escalade humaine si nécessaire.",
    solutions: [
      "Réponses IA instantanées (24/7)",
      "Détection intelligente d’intention (inquiry, booking, urgent)",
      "Suggestions automatiques de rendez-vous",
      "Escalade humaine pour les cas critiques",
      "Alertes Slack pour la visibilité équipe",
    ],
    featuresTitle: "Fonctionnalités",
    featuresText:
      "Ce n’est pas juste un chatbot. C’est un système de gestion de leads structuré et prêt à être adapté à de vrais besoins business.",
    features: [
      "Intégration WhatsApp (Meta API)",
      "Agent conversationnel IA",
      "Classification d’intention (GPT-based)",
      "Détection d’urgence & escalade",
      "Système de notifications Slack",
      "Structure prête pour CRM",
      "Intégration lien de réservation (Calendly)",
      "Architecture prête pour mémoire",
    ],
    demoTitle: "Démo visuelle",
    demoText:
      "Clique sur une capture pour l’ouvrir en grand et mieux visualiser le workflow, les alertes et l’expérience utilisateur.",
    workflowTitle: "Comment le système fonctionne",
    workflowText:
      "Pour le prospect, l’expérience est simple. En coulisses, le système route, qualifie et escalade selon des règles concrètes.",
    flowSteps: [
      "Le prospect envoie un message sur WhatsApp",
      "L’IA détecte l’intention (inquiry / booking / urgent)",
      "L’IA répond instantanément",
      "Si nécessaire → escalade vers un humain",
      "L’équipe reçoit une alerte via Slack",
      "Le lead reçoit une confirmation claire",
    ],
    stackTitle: "Stack technique",
    stackText:
      "Le système s’appuie sur des outils crédibles et prêts pour la production.",
    stack: [
      "n8n (workflow automation)",
      "OpenAI (AI agent)",
      "WhatsApp Cloud API",
      "Slack API",
      "Calendly",
      "Airtable / Notion / autre CRM",
    ],
    impactTitle: "Résultat business",
    impactText:
      "La valeur n’est pas seulement technique. Elle améliore directement la vitesse, la charge de travail et la conversion.",
    businessResults: [
      "Temps de réponse plus rapide (instantané vs heures)",
      "Meilleure conversion des leads",
      "Moins de charge pour l’équipe",
      "Meilleure gestion des cas urgents",
    ],
    useCasesTitle: "Autres domaines où ce système marche",
    useCasesText:
      "Ce flow peut être adapté à d’autres activités qui dépendent de la messagerie, des rendez-vous ou de la qualification rapide.",
    useCases: {
      "Santé & Médical": [
        "Cliniques",
        "Dentistes",
        "Physiothérapeutes",
        "Opticiens",
        "Dermatologues",
        "Médecins privés",
      ],
      "Services": [
        "Salons de beauté",
        "Coiffeurs",
        "Spas",
        "Centres de massage",
        "Tattoo studios",
      ],
      "Business locaux": [
        "Garages",
        "Services de nettoyage",
        "Agences immobilières",
        "Courtiers en assurance",
      ],
      "Services high-ticket": [
        "Coachs",
        "Consultants",
        "Agences",
        "Freelancers",
      ],
      Éducation: [
        "Centres de formation",
        "Cours en ligne",
        "Tuteurs",
      ],
    },
    ctaEyebrow: "Démo live",
    ctaTitle: "Tu veux ce système pour ton business ?",
    ctaText:
      "Teste la logique du système ou contacte directement le numéro business utilisé pour la démonstration.",
    ctaDemo: "Ouvrir la démo visuelle",
    ctaWhatsApp: "Tester en live sur WhatsApp",
    backHome: "Retour à l’accueil",
  },
  en: {
    badge: "AI WhatsApp Automation",
    heroTitle:
      "WhatsApp leads handled automatically, qualified instantly, and escalated at the right moment.",
    heroSubtitle:
      "This AI system replies to prospects 24/7, detects intent, pushes booking, and escalates urgent cases to your team via Slack.",
    primaryCta: "Open visual demo",
    secondaryCta: "Back to homepage",
    stats: [
      { label: "Availability", value: "24/7" },
      { label: "Core actions", value: "FAQ • Booking • Urgent" },
      { label: "Escalation", value: "Slack handoff" },
    ],
    productBoxTitle: "What this system does",
    productSteps: [
      {
        label: "Incoming lead message",
        text: "“I want to book an appointment”",
      },
      {
        label: "AI detection",
        text: "Booking intent is detected instantly",
      },
      {
        label: "Automated response",
        text: "The booking link is sent automatically",
      },
      {
        label: "Urgent fallback",
        text: "Critical cases trigger a Slack alert for the team",
      },
    ],
    problemTitle: "The problem this system solves",
    problemText:
      "Many businesses lose WhatsApp leads because replies are too slow, staff is overloaded, and there is no structured follow-up.",
    problems: [
      "Replies come too late",
      "Staff is overwhelmed",
      "No structured follow-up exists",
    ],
    solutionTitle: "The solution",
    solutionText:
      "This workflow automates the entire lead journey, from the first message to human escalation when needed.",
    solutions: [
      "Instant AI replies (24/7)",
      "Smart intent detection (inquiry, booking, urgent)",
      "Automated appointment suggestions",
      "Human escalation for critical cases",
      "Slack alerts for team visibility",
    ],
    featuresTitle: "Features",
    featuresText:
      "This is not just a chatbot. It is a structured lead handling system designed for real business workflows.",
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
    demoText:
      "Click any screenshot to open it larger and inspect the workflow, alerts, and end-user experience.",
    workflowTitle: "How the system works",
    workflowText:
      "For the lead, the experience feels simple. Under the hood, the system routes, qualifies, and escalates using real logic.",
    flowSteps: [
      "Lead sends a message on WhatsApp",
      "AI detects intent (inquiry / booking / urgent)",
      "AI responds instantly",
      "If needed → escalates to human",
      "Team receives a Slack alert",
      "Lead gets a clear confirmation message",
    ],
    stackTitle: "Tech stack",
    stackText:
      "The system is built on credible, production-ready tools.",
    stack: [
      "n8n (workflow automation)",
      "OpenAI (AI agent)",
      "WhatsApp Cloud API",
      "Slack API",
      "Calendly",
      "Airtable / Notion / any other CRM",
    ],
    impactTitle: "Business impact",
    impactText:
      "The value is not just technical. It directly improves speed, workload, and lead conversion.",
    businessResults: [
      "Faster response time (instant vs hours)",
      "Higher lead conversion",
      "Reduced staff workload",
      "Better handling of urgent cases",
    ],
    useCasesTitle: "Other industries this system fits",
    useCasesText:
      "This flow can be adapted to businesses that rely on messaging, appointments, or fast lead qualification.",
    useCases: {
      "Health & Medical": [
        "Clinics",
        "Dentists",
        "Physiotherapists",
        "Opticians",
        "Dermatologists",
        "Private doctors",
      ],
      "Service Businesses": [
        "Beauty salons",
        "Hairdressers",
        "Spas",
        "Massage centers",
        "Tattoo studios",
      ],
      "Local Businesses": [
        "Car repair shops",
        "Cleaning services",
        "Real estate agencies",
        "Insurance brokers",
      ],
      "High-ticket services": [
        "Coaches",
        "Consultants",
        "Agencies",
        "Freelancers",
      ],
      Education: [
        "Training centers",
        "Online courses",
        "Tutors",
      ],
    },
    ctaEyebrow: "Live demo",
    ctaTitle: "Want this system for your business?",
    ctaText:
      "Test the system logic or contact the business number used for this demo.",
    ctaDemo: "Open visual demo",
    ctaWhatsApp: "Test it live on WhatsApp",
    backHome: "Back to homepage",
  },
};

function SectionTitle({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text?: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-4xl">
        {title}
      </h2>
      {text ? (
        <p className="mt-4 text-base leading-8 text-white/68 md:text-lg">
          {text}
        </p>
      ) : null}
    </div>
  );
}

export default function WhatsAppLeadSystemPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [selectedImage, setSelectedImage] = useState<null | {
    src: string;
    alt: string;
  }>(null);

  useEffect(() => {
    const saved = localStorage.getItem(LANG_KEY) as Lang | null;
    if (saved === "fr" || saved === "en") {
      setLang(saved);
    }
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
      desc:
        lang === "fr"
          ? "Le workflow complet : détection du lead, logique de réservation, escalade urgente et handoff humain."
          : "The full workflow covering lead detection, booking logic, urgent escalation, and human handoff.",
    },
    {
      src: "/demo/slack-alert.png",
      alt: lang === "fr" ? "Capture alerte Slack" : "Slack alert screenshot",
      title: "Slack alert",
      desc:
        lang === "fr"
          ? "L’équipe reçoit une visibilité immédiate quand une intervention humaine est nécessaire."
          : "The team gets immediate visibility when a handoff or urgent case requires human attention.",
    },
    {
      src: "/demo/whatsapp-flow.png",
      alt: lang === "fr" ? "Capture conversation WhatsApp" : "WhatsApp flow screenshot",
      title: "WhatsApp flow",
      desc:
        lang === "fr"
          ? "Le prospect reçoit une réponse claire et rapide selon son intention."
          : "The lead receives a clear instant reply depending on the detected intent.",
    },
  ];

  return (
    <main className="min-h-screen bg-[#07111f] text-white">
      <section className="relative overflow-hidden border-b border-white/8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(54,109,255,0.18),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(37,211,102,0.12),transparent_30%)]" />
        <div className="absolute left-[-10%] top-[-20%] h-[420px] w-[420px] rounded-full bg-[#2b6fff]/10 blur-3xl" />
        <div className="absolute bottom-[-15%] right-[-10%] h-[340px] w-[340px] rounded-full bg-[#25D366]/10 blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-6 py-20 md:px-10 md:py-28">
          <div className="mb-8 flex justify-end">
            <div className="grid w-[140px] grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLang("fr")}
                className={`h-[42px] rounded-xl border border-white/10 text-white transition ${
                  lang === "fr"
                    ? "bg-[rgba(124,92,255,0.18)]"
                    : "bg-white/5"
                }`}
              >
                FR
              </button>
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`h-[42px] rounded-xl border border-white/10 text-white transition ${
                  lang === "en"
                    ? "bg-[rgba(124,92,255,0.18)]"
                    : "bg-white/5"
                }`}
              >
                EN
              </button>
            </div>
          </div>

          <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="inline-flex rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm text-white/75 backdrop-blur-sm">
                {t.badge}
              </div>

              <h1 className="mt-6 max-w-5xl text-4xl font-semibold tracking-tight text-white md:text-6xl md:leading-[1.04]">
                {t.heroTitle}
              </h1>

              <p className="mt-6 max-w-3xl text-lg leading-8 text-white/72">
                {t.heroSubtitle}
              </p>

              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <a
                  href="#demo"
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 font-semibold shadow-[0_10px_30px_rgba(255,255,255,0.08)] transition duration-300 hover:scale-[1.02] hover:shadow-[0_14px_40px_rgba(255,255,255,0.14)]"
                >
                  <span className="!text-[#000000]">{t.primaryCta}</span>
                </a>

                <Link
                  href="/"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/12 bg-white/6 px-6 py-3 font-semibold text-white backdrop-blur-sm transition duration-300 hover:scale-[1.02] hover:bg-white/10 hover:shadow-[0_12px_32px_rgba(255,255,255,0.08)]"
                >
                  {t.secondaryCta}
                </Link>
              </div>

              <div className="mt-10 grid gap-4 md:grid-cols-3">
                {t.stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
                  >
                    <p className="text-sm text-white/55">{stat.label}</p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[32px] border border-white/10 bg-white/6 p-6 shadow-2xl shadow-black/30 backdrop-blur-sm transition duration-500 hover:-translate-y-1 hover:shadow-[0_20px_70px_rgba(0,0,0,0.35)]">
              <div className="rounded-[24px] border border-white/10 bg-[#0b1628] p-6">
                <p className="text-sm text-white/50">{t.productBoxTitle}</p>

                <div className="mt-5 space-y-4">
                  {t.productSteps.map((step) => (
                    <div
                      key={step.label}
                      className="rounded-2xl border border-white/8 bg-white/5 p-4 transition duration-300 hover:bg-white/7"
                    >
                      <p className="text-sm text-white/50">{step.label}</p>
                      <p className="mt-1 text-white">{step.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <SectionTitle
          eyebrow={lang === "fr" ? "Problème" : "Problem"}
          title={t.problemTitle}
          text={t.problemText}
        />

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {t.problems.map((item) => (
            <div
              key={item}
              className="rounded-[28px] border border-white/10 bg-white/5 p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
            >
              <div className="mb-4 h-3 w-3 rounded-full bg-red-400" />
              <p className="text-lg font-medium leading-8 text-white/88">
                {item}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <SectionTitle
          eyebrow={lang === "fr" ? "Solution" : "Solution"}
          title={t.solutionTitle}
          text={t.solutionText}
        />

        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {t.solutions.map((item, index) => (
            <div
              key={item}
              className="rounded-[28px] border border-white/10 bg-white/5 p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-white font-semibold text-[#07111f]">
                {index + 1}
              </div>
              <p className="text-base leading-8 text-white/80">{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <SectionTitle
          eyebrow={lang === "fr" ? "Fonctionnalités" : "Features"}
          title={t.featuresTitle}
          text={t.featuresText}
        />

        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {t.features.map((item) => (
            <div
              key={item}
              className="rounded-[24px] border border-white/10 bg-white/5 p-5 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
            >
              <p className="text-sm leading-7 text-white/78">{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="demo" className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <SectionTitle
          eyebrow={lang === "fr" ? "Démo visuelle" : "Visual demo"}
          title={t.demoTitle}
          text={t.demoText}
        />

        <div className="mt-10 grid gap-8 lg:grid-cols-3">
          {demoImages.map((img) => (
            <button
              key={img.src}
              type="button"
              onClick={() => setSelectedImage({ src: img.src, alt: img.alt })}
              className="rounded-[28px] border border-white/10 bg-white/5 p-4 text-left transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
            >
              <div className="overflow-hidden rounded-[20px] border border-white/10">
                <Image
                  src={img.src}
                  alt={img.alt}
                  width={1400}
                  height={900}
                  className="h-auto w-full transition duration-500 hover:scale-[1.02]"
                />
              </div>
              <h3 className="mt-4 text-xl font-semibold text-white">
                {img.title}
              </h3>
              <p className="mt-2 text-sm leading-7 text-white/65">
                {img.desc}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <SectionTitle
              eyebrow={lang === "fr" ? "Workflow" : "Workflow"}
              title={t.workflowTitle}
              text={t.workflowText}
            />
          </div>

          <div className="space-y-4">
            {t.flowSteps.map((step, index) => (
              <div
                key={step}
                className="flex gap-4 rounded-[24px] border border-white/10 bg-white/5 p-5 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white font-semibold text-[#07111f]">
                  {index + 1}
                </div>
                <p className="pt-1 text-base leading-8 text-white/78">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-[32px] border border-white/10 bg-white/5 p-8 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7">
            <SectionTitle
              eyebrow={lang === "fr" ? "Stack technique" : "Tech stack"}
              title={t.stackTitle}
              text={t.stackText}
            />
            <div className="mt-8 flex flex-wrap gap-3">
              {t.stack.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-white/82 transition duration-300 hover:border-white/20 hover:bg-white/10"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] border border-white/10 bg-white/5 p-8 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7">
            <SectionTitle
              eyebrow={lang === "fr" ? "Impact business" : "Business impact"}
              title={t.impactTitle}
              text={t.impactText}
            />
            <div className="mt-8 space-y-4">
              {t.businessResults.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white/80 transition duration-300 hover:border-white/20 hover:bg-white/8"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <SectionTitle
          eyebrow={lang === "fr" ? "Cas d’usage" : "Use cases"}
          title={t.useCasesTitle}
          text={t.useCasesText}
        />

        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(t.useCases).map(([category, items]) => (
            <div
              key={category}
              className="rounded-[28px] border border-white/10 bg-white/5 p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
            >
              <h3 className="text-xl font-semibold text-white">{category}</h3>
              <div className="mt-4 flex flex-wrap gap-3">
                {items.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-white/10 bg-white/6 px-3 py-2 text-sm text-white/78 transition duration-300 hover:border-white/20 hover:bg-white/10"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 md:px-10">
        <div className="rounded-[36px] border border-white/10 bg-gradient-to-r from-[#18233c] via-[#0d1627] to-[#0a1220] p-10 text-center shadow-[0_20px_80px_rgba(0,0,0,0.28)]">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">
            {t.ctaEyebrow}
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
            {t.ctaTitle}
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-8 text-white/68 md:text-lg">
            {t.ctaText}
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="#demo"
              className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 font-semibold shadow-[0_10px_30px_rgba(255,255,255,0.08)] transition duration-300 hover:scale-[1.02] hover:shadow-[0_14px_40px_rgba(255,255,255,0.14)]"
            >
              <span className="!text-[#000000]">{t.ctaDemo}</span>
            </a>

            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-2xl bg-[#25D366] px-6 py-3 font-semibold text-[#04110a] shadow-[0_10px_30px_rgba(37,211,102,0.20)] transition duration-300 hover:scale-[1.02] hover:brightness-110 hover:shadow-[0_16px_40px_rgba(37,211,102,0.28)]"
            >
              {t.ctaWhatsApp}
            </a>
          </div>
        </div>
      </section>

      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[95vh] max-w-[95vw]"
          >
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className="absolute right-3 top-3 z-10 rounded-full bg-black/70 px-3 py-1 text-sm text-white"
            >
              ✕
            </button>

            <Image
              src={selectedImage.src}
              alt={selectedImage.alt}
              width={1800}
              height={1200}
              className="max-h-[90vh] w-auto rounded-2xl object-contain"
            />
          </div>
        </div>
      )}
    </main>
  );
}