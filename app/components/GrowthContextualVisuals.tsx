"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import styles from "./GrowthContextualVisuals.module.css";

export type ContextualIndustry = "south-africa" | "real-estate" | "beauty-aesthetics" | "restaurants" | "fitness";
type VisualLang = "fr" | "en";

const visualConfig: Record<ContextualIndustry, {
  src: string;
  alt: Record<VisualLang, string>;
  ecosystem: Record<VisualLang, string>;
  audience: Record<VisualLang, string>;
  discovery: Record<VisualLang, string>;
  intent: Record<VisualLang, string>;
}> = {
  "south-africa": {
    src: "/instagram-growth/contextual/south-africa-ecosystem-v1.png",
    alt: { fr: "Écosystème d’audiences locales sud-africaines convergeant vers un ciblage géré", en: "South African local audience ecosystems converging into managed targeting" },
    ecosystem: { fr: "Écosystème local", en: "Local ecosystem" },
    audience: { fr: "Audience pertinente", en: "Relevant audience" },
    discovery: { fr: "Découverte gérée", en: "Managed discovery" },
    intent: { fr: "Base d’audience renforcée", en: "Stronger audience foundation" },
  },
  "real-estate": {
    src: "/instagram-growth/contextual/real-estate-discovery-v1.png",
    alt: { fr: "Sources immobilières locales et contenu de propriété convergeant vers une audience pertinente", en: "Local property sources and real-estate content converging into a relevant audience" },
    ecosystem: { fr: "Marché immobilier", en: "Property ecosystem" },
    audience: { fr: "Audience immobilière", en: "Property-aware audience" },
    discovery: { fr: "Découverte du profil", en: "Profile discovery" },
    intent: { fr: "Signaux d’intérêt", en: "Intent signals" },
  },
  "beauty-aesthetics": {
    src: "/instagram-growth/contextual/beauty-discovery-v1.png",
    alt: { fr: "Studio beauté premium, contenus visuels et audience locale pertinente", en: "Premium beauty studio, visual content and a relevant local audience" },
    ecosystem: { fr: "Scène beauté locale", en: "Local beauty scene" },
    audience: { fr: "Audience beauté pertinente", en: "Relevant beauty audience" },
    discovery: { fr: "Découverte visuelle", en: "Visual discovery" },
    intent: { fr: "Intérêt et parcours éligibles", en: "Interest and eligible journeys" },
  },
  restaurants: {
    src: "/instagram-growth/contextual/restaurant-discovery-v1.png",
    alt: { fr: "Restaurant premium, contenus culinaires et audience locale convergente", en: "Premium restaurant, food content and a converging local audience" },
    ecosystem: { fr: "Écosystème food local", en: "Local food ecosystem" },
    audience: { fr: "Audience food pertinente", en: "Relevant food audience" },
    discovery: { fr: "Reels, menu et profil", en: "Reels, menu and profile" },
    intent: { fr: "Intention de visite", en: "Visit intent" },
  },
  fitness: {
    src: "/instagram-growth/contextual/fitness-discovery-v1.png",
    alt: { fr: "Studio fitness, communautés sportives et contenus d’entraînement connectés", en: "Fitness studio, sports communities and connected training content" },
    ecosystem: { fr: "Communautés actives", en: "Active communities" },
    audience: { fr: "Audience fitness pertinente", en: "Relevant fitness audience" },
    discovery: { fr: "Découverte du contenu", en: "Content discovery" },
    intent: { fr: "Intérêt essai ou coaching", en: "Trial or coaching interest" },
  },
};

export function ContextualValueVisual({
  industry,
  lang,
  sources,
  outcomes,
}: {
  industry: ContextualIndustry;
  lang: VisualLang;
  sources: string[];
  outcomes: string[];
}) {
  const copy = visualConfig[industry];

  return (
    <article className={`${styles.valueVisual} ${styles[`theme_${industry}`]}`}>
      <div className={styles.scene}>
        <Image src={copy.src} alt={copy.alt[lang]} fill sizes="(max-width: 760px) 100vw, 82vw" />
        <span className={styles.sceneShade} aria-hidden="true" />
        <div className={styles.sourceCluster}>
          <small>{copy.ecosystem[lang]}</small>
          {sources.slice(0, 5).map((source, index) => (
            <span key={source} style={{ "--delay": `${index * 90}ms` } as CSSProperties}><i aria-hidden="true" />{source}</span>
          ))}
        </div>
        <div className={styles.relevanceCore}>
          <span>AI</span>
          <strong>{copy.audience[lang]}</strong>
          <small>{lang === "fr" ? "sources sélectionnées + affinage" : "selected sources + refinement"}</small>
        </div>
        <div className={styles.discoveryPath} aria-label={`${copy.discovery[lang]} — ${copy.intent[lang]}`}>
          <span><i aria-hidden="true">01</i>{copy.discovery[lang]}</span>
          <b aria-hidden="true" />
          <span><i aria-hidden="true">02</i>{copy.intent[lang]}</span>
        </div>
      </div>
      <div className={styles.outcomeRail}>
        {outcomes.map((outcome, index) => <div key={outcome}><span>{String(index + 1).padStart(2, "0")}</span><strong>{outcome}</strong></div>)}
      </div>
    </article>
  );
}

export function SequentialProcessVisual({ lang }: { lang: VisualLang }) {
  const steps = lang === "fr"
    ? [
        { title: "Cartographier", detail: "Marché · villes · communautés" },
        { title: "Sélectionner", detail: "Sources crédibles et cohérentes" },
        { title: "Optimiser", detail: "Signaux observés et affinage" },
      ]
    : [
        { title: "Map", detail: "Market · cities · communities" },
        { title: "Select", detail: "Credible and aligned sources" },
        { title: "Optimize", detail: "Observed signals and refinement" },
      ];

  return (
    <article className={styles.processVisual}>
      <Image src="/instagram-growth/contextual/south-africa-ecosystem-v1.png" alt="" fill sizes="(max-width: 760px) 100vw, 82vw" aria-hidden="true" />
      <span className={styles.processShade} aria-hidden="true" />
      <div className={styles.marketNodes} aria-hidden="true">
        <span>JHB</span><span>CPT</span><span>DBN</span><span>PTA</span>
      </div>
      <div className={styles.processTrack}>
        {steps.map((step, index) => (
          <div className={styles.processStep} key={step.title} style={{ "--step": index } as CSSProperties}>
            <div className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</div>
            <div><strong>{step.title}</strong><small>{step.detail}</small></div>
            {index < steps.length - 1 ? <span className={styles.connector} aria-hidden="true"><i /></span> : null}
          </div>
        ))}
      </div>
      <div className={styles.refinedState}><i aria-hidden="true">✓</i><div><small>{lang === "fr" ? "ÉTAT CONCEPTUEL" : "CONCEPTUAL STATE"}</small><strong>{lang === "fr" ? "Campagne affinée" : "Campaign refined"}</strong></div></div>
    </article>
  );
}
