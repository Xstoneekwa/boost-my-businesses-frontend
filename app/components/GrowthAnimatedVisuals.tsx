"use client";

import Image from "next/image";
import styles from "./GrowthAnimatedVisuals.module.css";

export type VisualLang = "fr" | "en";
export type IndustryVisual = "real-estate" | "beauty-aesthetics" | "restaurants" | "fitness" | "south-africa";

type VisualShellProps = {
  eyebrow: string;
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
};

function VisualShell({ eyebrow, title, note, children, className = "" }: VisualShellProps) {
  return (
    <article className={`${styles.visual} ${styles.visible} ${className}`}>
      <header><span>{eyebrow}</span><h3>{title}</h3></header>
      <div className={styles.stage}>{children}</div>
      {note ? <p className={styles.note}>{note}</p> : null}
    </article>
  );
}

export function AnimatedComparisonChart({ lang }: { lang: VisualLang }) {
  const fr = lang === "fr";
  return (
    <VisualShell
      eyebrow={fr ? "AVEC / SANS BMB" : "WITH / WITHOUT BMB"}
      title={fr ? "D’une activité diffuse à une progression pilotée" : "From scattered activity to managed momentum"}
    >
      <Image className={styles.growthImage} src="/instagram-growth/animated/growth-momentum-v1.png" alt="" fill sizes="(max-width: 650px) 100vw, 50vw" aria-hidden="true" />
      <div className={styles.growthShade} aria-hidden="true" />
      <div className={styles.legend}><span className={styles.without}>{fr ? "Sans ciblage géré" : "Without managed targeting"}</span><span className={styles.with}>{fr ? "Avec BMB" : "With BMB"}</span></div>
      <svg className={styles.chart} viewBox="0 0 620 250" role="img" aria-label={fr ? "Comparaison illustrative de deux trajectoires de croissance" : "Illustrative comparison of two growth paths"}>
        <defs>
          <linearGradient id="comparison-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f4ad33" stopOpacity=".24"/><stop offset="1" stopColor="#f4ad33" stopOpacity="0"/></linearGradient>
        </defs>
        <g className={styles.gridLines}><path d="M42 40H594M42 94H594M42 148H594M42 202H594"/><path d="M42 28V215M180 28V215M318 28V215M456 28V215M594 28V215"/></g>
        <path className={styles.area} d="M42 202 C116 196 143 179 180 171 C246 156 271 145 318 120 C380 87 417 91 456 64 C505 31 550 35 594 19 L594 215 L42 215Z" />
        <path className={styles.lineMuted} pathLength="1" d="M42 188 C107 171 145 194 202 176 C264 157 298 184 354 161 C420 136 456 168 512 145 C548 132 566 139 594 124" />
        <path className={styles.lineGold} pathLength="1" d="M42 202 C116 196 143 179 180 171 C246 156 271 145 318 120 C380 87 417 91 456 64 C505 31 550 35 594 19" />
        <g className={styles.points}><circle cx="180" cy="171" r="6"/><circle cx="318" cy="120" r="6"/><circle cx="456" cy="64" r="6"/><circle cx="594" cy="19" r="6"/></g>
      </svg>
      <div className={styles.axis}><span>{fr ? "Départ" : "Start"}</span><span>{fr ? "Apprentissage" : "Learning"}</span><span>{fr ? "Affinage" : "Refinement"}</span><span>{fr ? "Régularité" : "Consistency"}</span></div>
    </VisualShell>
  );
}

export function AnimatedGrowthTimeline({ lang }: { lang: VisualLang }) {
  const fr = lang === "fr";
  const months = fr
    ? [["Mois 1", "Apprendre"], ["Mois 2", "Affiner"], ["Mois 3", "Consolider"]]
    : [["Month 1", "Learn"], ["Month 2", "Refine"], ["Month 3", "Compound"]];
  return (
    <VisualShell
      eyebrow={fr ? "PROGRESSION SUR 3 MOIS" : "3-MONTH PROGRESSION"}
      title={fr ? "Une boucle qui apprend et s’affine" : "A loop designed to learn and refine"}
    >
      <Image className={`${styles.growthImage} ${styles.timelineImage}`} src="/instagram-growth/animated/growth-momentum-v1.png" alt="" fill sizes="(max-width: 650px) 100vw, 50vw" aria-hidden="true" />
      <div className={styles.growthShade} aria-hidden="true" />
      <div className={styles.timeline}>
        <div className={styles.timelineTrack}><i /></div>
        {months.map(([month, action], index) => <div className={styles.milestone} style={{ "--delay": `${index * 170}ms` } as React.CSSProperties} key={month}><span>{index + 1}</span><small>{month}</small><strong>{action}</strong></div>)}
      </div>
      <div className={styles.signalBars} aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>
    </VisualShell>
  );
}

export function AudienceFlowVisual({ lang, sources }: { lang: VisualLang; sources: string[] }) {
  const fr = lang === "fr";
  const shownSources = sources.slice(0, 6);
  return (
    <VisualShell
      eyebrow={fr ? "CARTE D’AUDIENCE" : "AUDIENCE MAP"}
      title={fr ? "Des sources crédibles convergent vers une audience pertinente" : "Credible sources converge into a relevant audience"}
      className={styles.flowVisual}
    >
      <div className={styles.flowMap}>
        <Image className={styles.targetingImage} src="/instagram-growth/animated/smart-audience-targeting-v1.png" alt="" fill sizes="(max-width: 650px) 100vw, 50vw" aria-hidden="true" />
        <div className={styles.targetingShade} aria-hidden="true" />
        <div className={styles.sourceNodes}>{shownSources.map((source, index) => <span style={{ "--delay": `${index * 90}ms` } as React.CSSProperties} key={source}><i aria-hidden="true" />{source}</span>)}</div>
        <div className={styles.conduit} aria-hidden="true"><span/><span/><span/></div>
        <div className={styles.audienceCore}><i>AI</i><strong>{fr ? "Audience pertinente" : "Relevant audience"}</strong><small>{fr ? "signaux sélectionnés + affinage" : "selected signals + refinement"}</small></div>
        <div className={styles.outcomes}><span>{fr ? "Découverte" : "Discovery"}</span><span>{fr ? "Pertinence" : "Relevance"}</span><span>{fr ? "Portée locale" : "Local reach"}</span></div>
      </div>
    </VisualShell>
  );
}

export function ManagedInfrastructureVisual({ lang }: { lang: VisualLang }) {
  const fr = lang === "fr";
  const statuses = fr ? ["Guidage IA", "Téléphones réels", "Supervision humaine", "Rythme naturel"] : ["AI guidance", "Real phones", "Human oversight", "Natural pacing"];
  return (
    <VisualShell
      eyebrow={fr ? "INFRASTRUCTURE GÉRÉE" : "MANAGED INFRASTRUCTURE"}
      title={fr ? "Une orchestration réelle, visible et supervisée" : "A real, visible and supervised operation"}
      note={fr ? "Aucun achat d’abonnés. Aucun bot injecté. L’activité reste gérée par l’équipe BMB." : "No purchased followers. No injected bots. Activity remains managed by the BMB team."}
      className={styles.infrastructureVisual}
    >
      <div className={styles.infrastructureMap}>
        <div className={styles.phoneScene}><Image src="/instagram-growth/animated/managed-phone-infrastructure-v1.png" alt="" fill sizes="(max-width: 650px) 100vw, 50vw" aria-hidden="true" /><span aria-hidden="true" /></div>
        <div className={styles.aiNode}><span>AI</span><small>{fr ? "ciblage" : "targeting"}</small></div>
        <div className={styles.phoneSignal} aria-hidden="true"><i/><i/><i/></div>
        <div className={styles.teamNode}><span>✓</span><small>{fr ? "équipe" : "team"}</small></div>
        <div className={styles.statusRail}>{statuses.map((status, index) => <span style={{ "--delay": `${index * 120}ms` } as React.CSSProperties} key={status}><i/>{status}</span>)}</div>
      </div>
    </VisualShell>
  );
}

const journeyCopy: Record<IndustryVisual, { sources: { fr: string[]; en: string[] }; steps: { fr: string[]; en: string[] }; result: { fr: string; en: string } }> = {
  "real-estate": { sources: { fr: ["Quartiers", "Biens", "Finance"], en: ["Neighbourhoods", "Property", "Finance"] }, steps: { fr: ["Découverte locale", "Profil", "Contenu immobilier"], en: ["Local discovery", "Profile", "Property content"] }, result: { fr: "Intention acheteur · vendeur · investisseur", en: "Buyer · seller · investor intent" } },
  "beauty-aesthetics": { sources: { fr: ["Skincare", "Salons", "Bien-être"], en: ["Skincare", "Salons", "Wellness"] }, steps: { fr: ["Découverte locale", "Abonnement", "Preuve & confiance"], en: ["Local discovery", "Follow", "Proof & trust"] }, result: { fr: "Intention de réservation", en: "Booking intent" } },
  restaurants: { sources: { fr: ["Food local", "Créateurs", "Quartiers"], en: ["Local food", "Creators", "Neighbourhoods"] }, steps: { fr: ["Découverte", "Menu & reels", "Envie de visite"], en: ["Discovery", "Menu & reels", "Visit consideration"] }, result: { fr: "Visite · réservation · demande", en: "Visit · booking · enquiry" } },
  fitness: { sources: { fr: ["Salles", "Coachs", "Communautés"], en: ["Gyms", "Coaches", "Communities"] }, steps: { fr: ["Découverte", "Contenu training", "Projection"], en: ["Discovery", "Training content", "Consideration"] }, result: { fr: "Essai · adhésion · coaching", en: "Trial · membership · coaching" } },
  "south-africa": { sources: { fr: ["Johannesburg", "Cape Town", "Durban", "Pretoria"], en: ["Johannesburg", "Cape Town", "Durban", "Pretoria"] }, steps: { fr: ["Sources locales", "Signaux cohérents", "Affinage"], en: ["Local sources", "Aligned signals", "Refinement"] }, result: { fr: "Pertinence géographique, sans fausse précision", en: "Geographic relevance, without false precision" } },
};

export function IndustryJourneyVisual({ lang, industry }: { lang: VisualLang; industry: IndustryVisual }) {
  const fr = lang === "fr";
  const copy = journeyCopy[industry];
  return (
    <VisualShell
      eyebrow={fr ? "PARCOURS SECTORIEL" : "INDUSTRY JOURNEY"}
      title={fr ? "Du bon signal à une intention plus pertinente" : "From the right signal to more relevant intent"}
      className={styles.journeyVisual}
    >
      <div className={styles.journeyMap}>
        <Image className={styles.industryImage} src={`/instagram-growth/verticals/${industry}.png`} alt="" fill sizes="(max-width: 650px) 100vw, 50vw" aria-hidden="true" />
        <div className={styles.industryShade} aria-hidden="true" />
        <div className={styles.journeySources}>{copy.sources[lang].map((source, index) => <span style={{ "--delay": `${index * 100}ms` } as React.CSSProperties} key={source}>{source}</span>)}</div>
        <div className={styles.journeyLine} aria-hidden="true"><i/><i/><i/></div>
        <div className={styles.journeySteps}>{copy.steps[lang].map((step, index) => <div style={{ "--delay": `${index * 160}ms` } as React.CSSProperties} key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong></div>)}</div>
        <div className={styles.intentCard}><i aria-hidden="true">↗</i><strong>{copy.result[lang]}</strong></div>
      </div>
    </VisualShell>
  );
}
