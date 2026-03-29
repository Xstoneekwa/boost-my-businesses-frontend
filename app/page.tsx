"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Lang = "fr" | "en";

const LANG_KEY = "boost_ai_landing_lang_v1";

const copy = {
  fr: {
    badge: "SaaS Multi-Agents",
    title: "Un espace IA premium. Plusieurs agents business.",
    subtitle:
      "Présente tes systèmes IA comme un vrai produit SaaS avec une landing page propre, des pages agents dédiées et de la place pour une future monétisation.",
    primaryCta: "Tester l'agent général",
    secondaryCta: "Voir l'agent Sales",
    agents: [
      {
        label: "Agent 01",
        title: "Assistant général",
        desc: "Ton assistant connecté à n8n pour traiter de vraies demandes et exécuter des workflows.",
        href: "/agent/general",
        link: "Ouvrir la page →",
      },
      {
        label: "Agent 02",
        title: "Agent Sales",
        desc: "Future page dédiée aux workflows de vente, à la conversion de prospects et à la prospection outbound.",
        href: "/agent/sales",
        link: "Ouvrir la page →",
      },
      {
        label: "Agent 03",
        title: "Agent Support",
        desc: "Future page dédiée au support client, à l’automatisation de FAQ et à l’assistance utilisateur.",
        href: "/agent/support",
        link: "Ouvrir la page →",
      },
    ],
    bottomTitle: "Pourquoi cette structure est importante",
    bottomText:
      "Au lieu de montrer une simple démo générique, tu peux envoyer tes clients directement vers la page agent qui correspond à leur besoin. Ton offre devient plus claire, plus premium et plus facile à vendre.",
  },
  en: {
    badge: "Multi-Agent SaaS",
    title: "One premium AI workspace. Multiple business agents.",
    subtitle:
      "Present your AI systems like a real SaaS product with a clean landing page, dedicated agent pages, and room for future monetization.",
    primaryCta: "Try General Agent",
    secondaryCta: "View Sales Agent",
    agents: [
      {
        label: "Agent 01",
        title: "General Assistant",
        desc: "Your live n8n-connected assistant for real requests and workflow execution.",
        href: "/agent/general",
        link: "Open page →",
      },
      {
        label: "Agent 02",
        title: "Sales Agent",
        desc: "Future dedicated page for sales workflows, prospect conversion and outbound messaging.",
        href: "/agent/sales",
        link: "Open page →",
      },
      {
        label: "Agent 03",
        title: "Support Agent",
        desc: "Future dedicated page for customer support, FAQ automation and client assistance.",
        href: "/agent/support",
        link: "Open page →",
      },
    ],
    bottomTitle: "Why this structure matters",
    bottomText:
      "Instead of showing one generic demo, you can send clients directly to the agent page that matches their need. That makes your offer clearer, more premium, and easier to sell.",
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

        <div className="landing-actions">
          <Link href="/agent/general" className="primary-btn">
            {t.primaryCta}
          </Link>

          <Link href="/agent/sales" className="secondary-btn">
            {t.secondaryCta}
          </Link>
        </div>
      </section>

      <section className="landing-grid">
        {t.agents.map((agent) => (
          <div key={agent.title} className="landing-card">
            <div className="card-label">{agent.label}</div>
            <h3>{agent.title}</h3>
            <p>{agent.desc}</p>
            <Link href={agent.href} className="text-link">
              {agent.link}
            </Link>
          </div>
        ))}
      </section>

      <section className="landing-bottom">
        <div className="landing-bottom-card">
          <h2>{t.bottomTitle}</h2>
          <p>{t.bottomText}</p>
        </div>
      </section>
    </main>
  );
}