"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
      },
      {
        label: "Agent 02",
        title: "AI WhatsApp Lead Handling System",
        desc: "Répond instantanément aux leads WhatsApp, détecte l’intention, pousse à la réservation, transfère à un humain si nécessaire et gère les urgences.",
        result: "Capture plus de leads et augmente la conversion sans ralentir l’équipe.",
        href: "/agent/whatsapp-lead-system",
        link: "Ouvrir la page →",
      },
      {
        label: "Agent 03",
        title: "UGC Ads Engine",
        desc: "Transforme une simple idée ou image en vidéo UGC structurée avec script, hook, narration, direction vidéo, contrôle qualité et logique de fallback.",
        result: "Produit plus vite du contenu marketing prêt à publier et pensé pour convertir.",
        href: "/agent/ugc-ads-engine",
        link: "Ouvrir la page →",
      },
      {
        label: "Agent 04",
        title: "Agent Support IA",
        desc: "Gère les demandes fréquentes, automatise les FAQ et absorbe une partie du support avant intervention humaine.",
        result: "Réduit la charge support et améliore le temps de réponse client.",
        href: "/agent/support",
        link: "Ouvrir la page →",
      },
    ],
    useCasesTitle: "Cas d’usage",
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
        bullets: [
          "1 système IA",
          "1 cas d’usage principal",
          "Setup de base",
        ],
      },
      {
        name: "Growth",
        price: "À partir de 799€",
        description: "Plus de logique, plus d’intégrations, plus d’impact business.",
        bullets: [
          "1 à 2 systèmes IA",
          "Connexions outils métier",
          "Optimisé pour conversion / gain de temps",
        ],
        featured: true,
      },
      {
        name: "Custom",
        price: "Sur devis",
        description: "Architecture sur mesure pour besoin plus avancé.",
        bullets: [
          "Multi-flows",
          "Automatisations métier",
          "Support et évolution possibles",
        ],
      },
    ],
    bottomTitle: "Pourquoi cette structure est importante",
    bottomText:
      "Au lieu de montrer une simple démo générique, tu peux envoyer tes clients directement vers la page qui correspond à leur besoin. Ton offre devient plus claire, plus premium et plus facile à vendre.",
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
      },
      {
        label: "Agent 02",
        title: "AI WhatsApp Lead Handling System",
        desc: "Replies instantly to WhatsApp leads, detects intent, pushes booking, hands off to human staff when needed, and handles urgent cases.",
        result: "Capture more leads and improve conversion without slowing down your team.",
        href: "/agent/whatsapp-lead-system",
        link: "Open page →",
      },
      {
        label: "Agent 03",
        title: "UGC Ads Engine",
        desc: "Turns a simple idea or image into a structured UGC video with script, hook, narrative flow, video direction, quality control, and fallback logic.",
        result: "Produce ready-to-publish marketing content faster and with more consistency.",
        href: "/agent/ugc-ads-engine",
        link: "Open page →",
      },
      {
        label: "Agent 04",
        title: "AI Support Agent",
        desc: "Handles common support requests, automates FAQs, and absorbs part of the support load before human intervention.",
        result: "Reduce support workload and improve response time.",
        href: "/agent/support",
        link: "Open page →",
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
        bullets: [
          "1 AI system",
          "1 main use case",
          "Basic setup",
        ],
      },
      {
        name: "Growth",
        price: "From €799",
        description: "More logic, more integrations, more business impact.",
        bullets: [
          "1 to 2 AI systems",
          "Business tool integrations",
          "Optimized for conversion / time savings",
        ],
        featured: true,
      },
      {
        name: "Custom",
        price: "Custom quote",
        description: "Tailored architecture for more advanced workflows.",
        bullets: [
          "Multi-flow setup",
          "Business automation logic",
          "Support and evolution options",
        ],
      },
    ],
    bottomTitle: "Why this structure matters",
    bottomText:
      "Instead of showing one generic demo, you can send clients directly to the page that matches their need. That makes your offer clearer, more premium, and easier to sell.",
  },
};

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>("en");

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

  return (
    <main className="landing-page">
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            width: 140,
          }}
        >
          <button
            type="button"
            onClick={() => setLang("fr")}
            style={{
              height: 42,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background:
                lang === "fr"
                  ? "rgba(124, 92, 255, 0.18)"
                  : "rgba(255,255,255,0.04)",
              color: "white",
              cursor: "pointer",
            }}
          >
            FR
          </button>
          <button
            type="button"
            onClick={() => setLang("en")}
            style={{
              height: 42,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background:
                lang === "en"
                  ? "rgba(124, 92, 255, 0.18)"
                  : "rgba(255,255,255,0.04)",
              color: "white",
              cursor: "pointer",
            }}
          >
            EN
          </button>
        </div>
      </div>

      <section className="landing-hero">
        <div className="hero-badge">{t.badge}</div>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 18,
            marginBottom: 6,
          }}
        >
          {t.proof.map((item) => (
            <span
              key={item}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.82)",
                fontSize: 13,
              }}
            >
              {item}
            </span>
          ))}
        </div>

        <div className="landing-actions">
          <Link href="/agent/general" className="primary-btn">
            {t.primaryCta}
          </Link>

          <Link href="/agent/ugc-ads-engine" className="secondary-btn">
            {t.secondaryCta}
          </Link>
        </div>
      </section>

      <section style={{ marginTop: 24, marginBottom: 14 }}>
        <h2
          style={{
            fontSize: "1.7rem",
            fontWeight: 700,
            color: "white",
            marginBottom: 10,
          }}
        >
          {t.agentsTitle}
        </h2>
      </section>

      <section
        className="landing-grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        }}
      >
        {t.agents.map((agent) => (
          <div key={agent.title} className="landing-card">
            <div className="card-label">{agent.label}</div>
            <h3>{agent.title}</h3>
            <p>{agent.desc}</p>

            <div
              style={{
                marginTop: 14,
                padding: "12px 14px",
                borderRadius: 14,
                background: "rgba(124, 92, 255, 0.08)",
                border: "1px solid rgba(124, 92, 255, 0.14)",
                color: "rgba(255,255,255,0.88)",
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              <strong style={{ color: "white" }}>
                {lang === "fr" ? "Résultat :" : "Outcome:"}
              </strong>{" "}
              {agent.result}
            </div>

            <Link href={agent.href} className="text-link">
              {agent.link}
            </Link>
          </div>
        ))}
      </section>

      <section className="landing-bottom" style={{ marginTop: 26 }}>
        <div className="landing-bottom-card">
          <h2>{t.useCasesTitle}</h2>
          <p style={{ marginBottom: 18 }}>{t.useCasesText}</p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            {t.useCases.map((item) => (
              <span
                key={item}
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.82)",
                  fontSize: 14,
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-bottom" style={{ marginTop: 22 }}>
        <div className="landing-bottom-card">
          <h2>{t.pricingTitle}</h2>
          <p style={{ marginBottom: 24 }}>{t.pricingText}</p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 18,
            }}
          >
            {t.pricing.map((plan) => (
              <div
                key={plan.name}
                style={{
                  borderRadius: 24,
                  padding: 22,
                  background: plan.featured
                    ? "linear-gradient(180deg, rgba(124,92,255,0.16), rgba(255,255,255,0.04))"
                    : "rgba(255,255,255,0.03)",
                  border: plan.featured
                    ? "1px solid rgba(124,92,255,0.28)"
                    : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: "rgba(255,255,255,0.62)",
                    marginBottom: 6,
                  }}
                >
                  {plan.name}
                </div>

                <div
                  style={{
                    fontSize: "1.8rem",
                    fontWeight: 800,
                    color: "white",
                    marginBottom: 10,
                  }}
                >
                  {plan.price}
                </div>

                <p
                  style={{
                    color: "rgba(255,255,255,0.72)",
                    lineHeight: 1.6,
                    marginBottom: 14,
                  }}
                >
                  {plan.description}
                </p>

                <div style={{ display: "grid", gap: 8 }}>
                  {plan.bullets.map((bullet) => (
                    <div
                      key={bullet}
                      style={{
                        color: "rgba(255,255,255,0.82)",
                        fontSize: 14,
                      }}
                    >
                      • {bullet}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-bottom" style={{ marginTop: 22 }}>
        <div className="landing-bottom-card">
          <h2>{t.bottomTitle}</h2>
          <p>{t.bottomText}</p>
        </div>
      </section>
    </main>
  );
}