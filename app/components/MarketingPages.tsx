"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMarketingLanguage as useLanguage } from "./useMarketingLanguage";
import styles from "./MarketingPages.module.css";

type Lang = "fr" | "en";

const CALENDLY_URL = "https://calendly.com/boostmybusinesses/discovertheassistant";
const HOME_URL = "https://www.boostmybusinesses.com";

const profiles = [
  { name: "Maison Sevel", handle: "@maison.sevel", start: 12680, gain: 840, city: "Genève" },
  { name: "Studio Noma", handle: "@studionoma.co", start: 8426, gain: 517, city: "Bruxelles" },
  { name: "Athletic Lab", handle: "@athleticlab", start: 19342, gain: 728, city: "Cape Town" },
];

const homeCopy = {
  fr: {
    nav: { product: "Instagram Growth", automation: "Automatisation IA", proof: "Résultats", plans: "Formules", call: "Réserver un appel", start: "Découvrir Instagram Growth", dashboard: "Dashboard" },
    hero: { eyebrow: "INSTAGRAM GROWTH · PRODUIT PRINCIPAL", titleA: "Vos prochains clients sont déjà", titleB: "sur Instagram.", lead: "Nous développons votre audience avec des profils réels, ciblés et géolocalisés — grâce à des agents IA opérant depuis de vrais téléphones, entièrement gérés par notre équipe.", primary: "Découvrir Instagram Growth", secondary: "Explorer l’automatisation IA", checks: ["Actif sous 24h", "Vrais téléphones", "Pilotage humain + IA"] },
    preview: { live: "En direct", followers: "abonnés", month: "ce mois-ci", activity: "Activité ciblée", followed: "a rejoint votre audience", today: "nouveaux abonnés aujourd’hui", managed: "Campagne optimisée en continu" },
    proof: { line: "Une croissance Instagram conçue pour les entreprises ambitieuses", metrics: [{ n: "200–800", l: "abonnés ciblés / mois" }, { n: "24/7", l: "automatisation supervisée" }, { n: "0", l: "bot ou faux profil" }] },
    why: { eyebrow: "POURQUOI ÇA FONCTIONNE", title: "Une acquisition Instagram plus intelligente, pas seulement plus active.", lead: "Chaque campagne associe ciblage précis, rythme naturel et optimisation continue pour transformer la visibilité en audience utile.", visualAlt: "Un instrument optique transforme un flux d’attention dispersé en parcours d’acquisition structurés.", flow: ["Attention brute", "Ciblage", "Rythme naturel", "Optimisation", "Acquisition utile"], supervision: "Supervision continue", cards: [{ n: "01", t: "Ciblage qui comprend votre marché", d: "Concurrents, localisation, niche et signaux d’intérêt sont combinés pour identifier les audiences les plus pertinentes." }, { n: "02", t: "Actions naturelles depuis de vrais appareils", d: "L’activité est progressive et exécutée depuis notre infrastructure de téléphones, avec des limites adaptées au compte." }, { n: "03", t: "Optimisation réellement gérée", d: "Votre manager affine les sources, suit la qualité de croissance et ajuste la campagne au fil des résultats." }] },
    uses: { eyebrow: "POUR QUI", title: "La même mécanique, adaptée à votre façon de grandir.", visualAlt: "Quatre univers métiers convergent vers un moteur de ciblage qui organise des audiences adaptées à chaque secteur.", flow: ["Contexte métier", "Ciblage adaptatif", "Audience pertinente"], cards: [{ t: "Marques & e-commerce", d: "Attirez une audience affinitaire autour de vos produits et de votre univers." }, { t: "Coachs & consultants", d: "Rendez votre expertise visible auprès de prospects qui correspondent à votre offre." }, { t: "Restaurants & lieux", d: "Développez une communauté locale autour de votre établissement." }, { t: "Créateurs & personnalités", d: "Accélérez une croissance organique cohérente avec votre positionnement." }] },
    plans: { eyebrow: "TROIS NIVEAUX DE CROISSANCE", title: "Commencez avec le moteur adapté à votre ambition.", lead: "Growth construit l’audience. Pro affine le ciblage et lance les conversations. Premium ajoute une acquisition avancée pilotée par l’IA.", cards: [{ t: "Growth", tag: "Construisez votre audience ciblée.", d: "Le socle de croissance entièrement géré." }, { t: "Pro", tag: "Ciblez plus intelligemment. Lancez des conversations.", d: "Pour transformer davantage de nouveaux abonnés en opportunités." }, { t: "Premium", tag: "Acquisition Instagram avancée, pilotée par l’IA.", d: "Pour les marques qui veulent maximiser ciblage, personnalisation et portée." }], cta: "Voir les formules et tarifs" },
    beyond: { eyebrow: "AU-DELÀ D’INSTAGRAM", title: "L’IA peut aussi faire avancer le reste de votre business.", lead: "Quand Instagram Growth attire l’attention, nos systèmes d’automatisation peuvent répondre aux appels, qualifier les leads, gérer le support et accélérer la création de contenu.", items: ["Assistants téléphoniques IA", "Automatisation WhatsApp & leads", "Support client automatisé", "UGC & moteurs créatifs"], cta: "Explorer AI Automation" },
    stories: { eyebrow: "UNE ÉQUIPE, PAS UN SIMPLE OUTIL", title: "Des systèmes pensés pour fonctionner sur le terrain.", quotes: [{ q: "Le système nous aide à réduire les opportunités manquées pendant les périodes chargées.", n: "Rachelle", s: "Restaurant · In de Patattezak", img: "/assets/rachelle.jpg" }, { q: "L’architecture est fiable, flexible et vraiment conçue pour une utilisation en conditions réelles.", n: "Patrick K.", s: "Conseil en ingénierie · DMT", img: "/assets/patrick.jpg" }, { q: "Nous gérons les demandes plus efficacement sans alourdir la charge de l’équipe.", n: "Laurianne", s: "ONG · Save Animals", img: "/assets/laurianne.jpg" }] },
    final: { eyebrow: "PRÊT À GRANDIR ?", title: "Faites d’Instagram un canal d’acquisition qui travaille chaque jour.", primary: "Démarrer avec Instagram Growth", secondary: "Réserver un appel" },
  },
  en: {
    nav: { product: "Instagram Growth", automation: "AI Automation", proof: "Results", plans: "Plans", call: "Book a call", start: "Explore Instagram Growth", dashboard: "Dashboard" },
    hero: { eyebrow: "INSTAGRAM GROWTH · FLAGSHIP PRODUCT", titleA: "Your next customers are already", titleB: "on Instagram.", lead: "We grow your audience with real, targeted, geo-relevant profiles — using AI agents operating from real phones, fully managed by our team.", primary: "Explore Instagram Growth", secondary: "Explore AI Automation", checks: ["Live in 24h", "Real phones", "Human + AI managed"] },
    preview: { live: "Live", followers: "followers", month: "this month", activity: "Targeted activity", followed: "joined your audience", today: "new followers today", managed: "Campaign continuously optimized" },
    proof: { line: "Instagram growth built for ambitious businesses", metrics: [{ n: "200–800", l: "targeted followers / month" }, { n: "24/7", l: "supervised automation" }, { n: "0", l: "bots or fake profiles" }] },
    why: { eyebrow: "WHY IT WORKS", title: "Smarter Instagram acquisition, not just more activity.", lead: "Every campaign combines precise targeting, natural pacing and continuous optimization to turn visibility into a useful audience.", visualAlt: "An optical instrument refines a scattered flow of attention into structured acquisition paths.", flow: ["Raw attention", "Targeting", "Natural pacing", "Optimization", "Useful acquisition"], supervision: "Continuous supervision", cards: [{ n: "01", t: "Targeting that understands your market", d: "Competitors, location, niche and intent signals combine to identify the most relevant audiences." }, { n: "02", t: "Natural actions from real devices", d: "Activity is progressive and runs from our phone infrastructure, with limits adapted to the account." }, { n: "03", t: "Optimization that is truly managed", d: "Your manager refines sources, monitors growth quality and adjusts the campaign as results arrive." }] },
    uses: { eyebrow: "BUILT FOR", title: "One growth engine, adapted to the way you do business.", visualAlt: "Four business environments converge into a targeting engine that organizes relevant audiences for each sector.", flow: ["Business context", "Adaptive targeting", "Relevant audience"], cards: [{ t: "Brands & e-commerce", d: "Attract an aligned audience around your products and brand world." }, { t: "Coaches & consultants", d: "Put your expertise in front of prospects who fit your offer." }, { t: "Restaurants & venues", d: "Build a local community around your location." }, { t: "Creators & public figures", d: "Accelerate organic growth that matches your positioning." }] },
    plans: { eyebrow: "THREE LEVELS OF GROWTH", title: "Start with the engine that matches your ambition.", lead: "Growth builds the audience. Pro sharpens targeting and starts conversations. Premium adds advanced AI-powered acquisition.", cards: [{ t: "Growth", tag: "Build your targeted audience.", d: "The fully managed growth foundation." }, { t: "Pro", tag: "Target smarter. Start conversations.", d: "For turning more new followers into opportunities." }, { t: "Premium", tag: "Advanced, AI-powered Instagram acquisition.", d: "For brands ready to maximize targeting, personalization and reach." }], cta: "See plans and pricing" },
    beyond: { eyebrow: "BEYOND INSTAGRAM", title: "AI can move the rest of your business forward too.", lead: "When Instagram Growth earns attention, our automation systems can answer calls, qualify leads, handle support and accelerate content production.", items: ["AI call assistants", "WhatsApp & lead automation", "Customer support automation", "UGC & creative engines"], cta: "Explore AI Automation" },
    stories: { eyebrow: "A TEAM, NOT JUST A TOOL", title: "Systems designed to work in the real world.", quotes: [{ q: "The system helps us reduce missed opportunities during busy periods.", n: "Rachelle", s: "Restaurant · In de Patattezak", img: "/assets/rachelle.jpg" }, { q: "The architecture is reliable, flexible and genuinely built for real-world use.", n: "Patrick K.", s: "Engineering consulting · DMT", img: "/assets/patrick.jpg" }, { q: "We handle requests more efficiently without adding to the team’s workload.", n: "Laurianne", s: "Non-profit · Save Animals", img: "/assets/laurianne.jpg" }] },
    final: { eyebrow: "READY TO GROW?", title: "Turn Instagram into an acquisition channel that works every day.", primary: "Start with Instagram Growth", secondary: "Book a call" },
  },
};

const automationCopy = {
  fr: {
    nav: { product: "Instagram Growth", automation: "Automatisation IA", services: "Systèmes", process: "Méthode", call: "Réserver un appel", start: "Parler de votre projet", dashboard: "Dashboard" },
    hero: { eyebrow: "AI AUTOMATION · SERVICES COMPLÉMENTAIRES", title: "Automatisez le travail répétitif. Gardez l’humain là où il compte.", lead: "Des systèmes IA conçus autour de vos vrais process : appels, messages, qualification, support, création et opérations. Configurés, intégrés et optimisés par notre équipe.", primary: "Découvrir les systèmes", secondary: "Instagram Growth reste notre produit principal", badge: "Au-delà d’Instagram Growth" },
    systems: { eyebrow: "SYSTÈMES IA", title: "Un problème métier précis. Un système conçu pour le résoudre.", lead: "Choisissez une brique ou combinez plusieurs automatisations dans un workflow cohérent.", cards: [{ k: "VOICE", t: "Assistants téléphoniques IA", d: "Répondent aux appels, collectent les informations utiles, gèrent les demandes courantes et transmettent les cas qui nécessitent votre équipe.", href: "/agent/restaurant-call-assistant", link: "Voir l’assistant d’appels" }, { k: "LEADS", t: "Automatisation WhatsApp", d: "Répond aux prospects, détecte l’intention, qualifie les demandes et déclenche le bon suivi sans ralentir votre équipe.", href: "/agent/whatsapp-lead-system", link: "Voir WhatsApp Leads" }, { k: "SUPPORT", t: "Support client automatisé", d: "Traite les questions fréquentes, structure les réponses et prépare une transmission propre pour les cas complexes.", href: "/agent/support", link: "Voir le Support Agent" }, { k: "CREATIVE", t: "UGC & Ads Engine", d: "Transforme une idée ou un visuel en concepts, scripts et assets UGC structurés, prêts pour la production marketing.", href: "/agent/ugc-ads-engine", link: "Voir UGC Ads Engine" }, { k: "WORKFLOW", t: "Automatisation des process métier", d: "Connecte vos outils, notifications, tableaux de bord et tâches récurrentes pour rendre les opérations plus rapides et plus fiables.", href: "/agent/general", link: "Voir l’AI Assistant" }] },
    method: { eyebrow: "NOTRE MÉTHODE", title: "Pas un chatbot posé sur votre site. Une automatisation reliée à votre réalité.", steps: [{ n: "01", t: "Cartographier", d: "Nous identifions les tâches répétitives, les règles de routage et les points de friction." }, { n: "02", t: "Construire", d: "Nous configurons les prompts, workflows, intégrations et garde-fous autour de votre cas d’usage." }, { n: "03", t: "Déployer", d: "Le système est testé en conditions réelles puis mis en service avec des transmissions humaines claires." }, { n: "04", t: "Optimiser", d: "Nous suivons les résultats et affinons la logique pour améliorer la qualité au fil du temps." }] },
    canvas: { eyebrow: "ORCHESTRATION", title: "Vos canaux entrent. Les bonnes actions ressortent.", nodes: ["Appels", "WhatsApp", "Formulaires", "E-mail"], center: "BMB AI", outputs: ["Réponse", "Qualification", "Réservation", "Escalade"] },
    fit: { eyebrow: "CAS D’USAGE", title: "Conçu pour les équipes qui ne peuvent pas se permettre de laisser des demandes sans réponse.", items: ["Restaurants & hospitality", "Agences & consultants", "Services sur rendez-vous", "E-commerce & marques", "Équipes support", "Opérations multi-sites"] },
    primary: { eyebrow: "NOTRE PRODUIT PRINCIPAL", title: "Vous cherchez d’abord à développer votre audience Instagram ?", lead: "Instagram Growth reste le point d’entrée principal de Boost My Businesses : ciblage, croissance et optimisation entièrement gérés.", cta: "Découvrir Instagram Growth" },
    final: { eyebrow: "PARLONS DE VOTRE WORKFLOW", title: "Montrez-nous ce qui ralentit votre équipe. Nous vous montrerons ce qui peut être automatisé.", primary: "Réserver un appel", secondary: "Nous contacter" },
  },
  en: {
    nav: { product: "Instagram Growth", automation: "AI Automation", services: "Systems", process: "Method", call: "Book a call", start: "Discuss your project", dashboard: "Dashboard" },
    hero: { eyebrow: "AI AUTOMATION · COMPLEMENTARY SERVICES", title: "Automate repetitive work. Keep people where they matter.", lead: "AI systems built around your real workflows: calls, messages, qualification, support, creation and operations. Configured, integrated and optimized by our team.", primary: "Explore the systems", secondary: "Instagram Growth remains our flagship", badge: "Beyond Instagram Growth" },
    systems: { eyebrow: "AI SYSTEMS", title: "One precise business problem. One system designed to solve it.", lead: "Choose one building block or combine several automations into a coherent workflow.", cards: [{ k: "VOICE", t: "AI call assistants", d: "Answer calls, capture useful details, handle routine requests and hand over the cases that need your team.", href: "/agent/restaurant-call-assistant", link: "See the call assistant" }, { k: "LEADS", t: "WhatsApp automation", d: "Responds to prospects, detects intent, qualifies requests and triggers the right follow-up without slowing your team down.", href: "/agent/whatsapp-lead-system", link: "See WhatsApp Leads" }, { k: "SUPPORT", t: "Customer support automation", d: "Handles frequent questions, structures responses and prepares a clean handoff for complex cases.", href: "/agent/support", link: "See the Support Agent" }, { k: "CREATIVE", t: "UGC & Ads Engine", d: "Turns an idea or visual into structured UGC concepts, scripts and assets ready for marketing production.", href: "/agent/ugc-ads-engine", link: "See UGC Ads Engine" }, { k: "WORKFLOW", t: "Business workflow automation", d: "Connects tools, notifications, dashboards and recurring tasks to make operations faster and more reliable.", href: "/agent/general", link: "See the AI Assistant" }] },
    method: { eyebrow: "OUR METHOD", title: "Not a chatbot dropped onto your site. Automation connected to your reality.", steps: [{ n: "01", t: "Map", d: "We identify repetitive tasks, routing rules and points of friction." }, { n: "02", t: "Build", d: "We configure prompts, workflows, integrations and guardrails around your use case." }, { n: "03", t: "Deploy", d: "The system is tested in real conditions, then launched with clear human handoffs." }, { n: "04", t: "Optimize", d: "We track outcomes and refine the logic to improve quality over time." }] },
    canvas: { eyebrow: "ORCHESTRATION", title: "Your channels come in. The right actions come out.", nodes: ["Calls", "WhatsApp", "Forms", "Email"], center: "BMB AI", outputs: ["Response", "Qualification", "Booking", "Handoff"] },
    fit: { eyebrow: "USE CASES", title: "Built for teams that cannot afford to leave requests unanswered.", items: ["Restaurants & hospitality", "Agencies & consultants", "Appointment-based services", "E-commerce & brands", "Support teams", "Multi-location operations"] },
    primary: { eyebrow: "OUR FLAGSHIP PRODUCT", title: "Is growing your Instagram audience the first priority?", lead: "Instagram Growth remains the main entry point into Boost My Businesses: targeting, growth and optimization, fully managed.", cta: "Explore Instagram Growth" },
    final: { eyebrow: "LET’S TALK ABOUT YOUR WORKFLOW", title: "Show us what slows your team down. We’ll show you what can be automated.", primary: "Book a call", secondary: "Contact us" },
  },
};

function Brand() {
  return (
    <Link className={styles.brand} href={HOME_URL} aria-label="Boost My Businesses">
      <Image src="/instagram-growth/assets/icon-square-256.png" alt="" width={38} height={38} aria-hidden="true" />
      <span>Boost<span>My</span>Businesses</span>
    </Link>
  );
}

function LanguageSwitch({ lang, setLang }: { lang: Lang; setLang: (lang: Lang) => void }) {
  return (
    <div className={styles.language} aria-label="Language">
      {(["fr", "en"] as const).map((option) => (
        <button key={option} type="button" className={lang === option ? styles.languageActive : ""} onClick={() => setLang(option)}>{option.toUpperCase()}</button>
      ))}
    </div>
  );
}

function MarketingNav({ lang, page }: { lang: Lang; page: "home" | "automation" }) {
  const [current, setLang] = useLanguage();
  const t = page === "home" ? homeCopy[lang].nav : automationCopy[lang].nav;
  return (
    <header className={styles.nav}>
      <div className={styles.navInner}>
        <Brand />
        <nav className={styles.navLinks} aria-label="Main navigation">
          <Link href="/instagram-growth">{t.product}</Link>
          <Link href="/instagram-growth-south-africa">South Africa</Link>
          <Link href="/ai-automation">{t.automation}</Link>
          <a href={page === "home" ? "#results" : "#systems"}>{page === "home" ? homeCopy[lang].nav.proof : automationCopy[lang].nav.services}</a>
          <a href={page === "home" ? "#plans" : "#method"}>{page === "home" ? homeCopy[lang].nav.plans : automationCopy[lang].nav.process}</a>
        </nav>
        <div className={styles.navActions}>
          <Link className={styles.partnerLink} href="/partners">{lang === "fr" ? "Partenaires" : "Partners"}</Link>
          <LanguageSwitch lang={current} setLang={setLang} />
          <a className={styles.navCall} href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">{t.call}</a>
          <Link className={styles.navCta} href={page === "home" ? "/instagram-growth" : "/contact"}>{t.start}</Link>
          <Link className={styles.dashboardLink} href="/instagram-login" aria-label={t.dashboard}>↗</Link>
        </div>
      </div>
    </header>
  );
}

function DynamicInstagramPreview({ lang }: { lang: Lang }) {
  const t = homeCopy[lang].preview;
  const [profileIndex, setProfileIndex] = useState(0);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const followerTimer = window.setInterval(() => setPulse((value) => value + 1), 1800);
    const profileTimer = window.setInterval(() => setProfileIndex((value) => (value + 1) % profiles.length), 5200);
    return () => {
      window.clearInterval(followerTimer);
      window.clearInterval(profileTimer);
    };
  }, []);
  const profile = profiles[profileIndex];
  const followerCount = profile.start + (pulse % 19);
  return (
    <div className={styles.previewShell} data-testid="dynamic-instagram-preview">
      <div className={styles.previewGlow} />
      <div className={styles.previewTop}>
        <div className={styles.previewProfile}>
          <span className={styles.avatar}>{profile.name.charAt(0)}</span>
          <span><strong>{profile.name}</strong><small>{profile.handle}</small></span>
        </div>
        <span className={styles.liveBadge}><i />{t.live}</span>
      </div>
      <div className={styles.previewNumber}>{followerCount.toLocaleString(lang === "fr" ? "fr-FR" : "en-US")}</div>
      <div className={styles.previewSub}>{t.followers} · <strong>+{profile.gain}</strong> {t.month}</div>
      <div className={styles.bars}>{[28, 36, 34, 52, 46, 66, 61, 78, 72, 92, 87, 100].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
      <div className={styles.activity}>
        <div className={styles.activityHead}><span>{t.activity}</span><span>{profile.city}</span></div>
        {["@atelier.nova", "@thegoodstudio", "@urban.motion"].map((handle, index) => (
          <div className={styles.activityRow} key={handle}><i /><span><strong>{handle}</strong> {t.followed}</span><small>{index + 1}m</small></div>
        ))}
      </div>
      <div className={styles.previewFoot}><span><strong>+{24 + (pulse % 7)}</strong> {t.today}</span><span>✓ {t.managed}</span></div>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className={styles.eyebrow}>{children}</span>;
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function SiteFooter({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <footer className={styles.footer}>
      <div className={styles.footerTop}>
        <div><Brand /><p>{fr ? "Instagram Growth comme produit principal. L’automatisation IA quand votre business est prêt à aller plus loin." : "Instagram Growth as the flagship. AI automation when your business is ready to go further."}</p></div>
        <div><strong>Instagram Growth</strong><Link href="/instagram-growth">{fr ? "Vue d’ensemble" : "Overview"}</Link><Link href="/instagram-growth-south-africa">South Africa</Link><Link href="/instagram-growth/real-estate">{fr ? "Immobilier" : "Real Estate"}</Link><Link href="/instagram-growth/beauty-aesthetics">{fr ? "Beauté & esthétique" : "Beauty & Aesthetics"}</Link><Link href="/instagram-growth/restaurants">Restaurants</Link><Link href="/instagram-growth/fitness">Fitness</Link></div>
        <div><strong>{fr ? "Automatisation IA" : "AI Automation"}</strong><Link href="/ai-automation">AI Automation</Link></div>
        <div><strong>{fr ? "Société" : "Company"}</strong><Link href="/">{fr ? "Accueil" : "Home"}</Link><Link href="/partners">{fr ? "Partenaires" : "Partners"}</Link><Link href="/about">{fr ? "À propos" : "About"}</Link><Link href="/contact">Contact</Link></div>
        <div><strong>{fr ? "Compte" : "Account"}</strong><Link href="/instagram-login">Dashboard</Link></div>
        <div><strong>{fr ? "Légal" : "Legal"}</strong><Link href="/privacy-policy">{fr ? "Confidentialité" : "Privacy"}</Link><Link href="/terms-and-conditions">{fr ? "Conditions" : "Terms"}</Link><Link href="/refund-policy">{fr ? "Remboursement" : "Refunds"}</Link></div>
      </div>
      <div className={styles.footerBottom}><span>© 2026 Boost My Businesses Ltd.</span><span>London · United Kingdom</span></div>
    </footer>
  );
}

function SequencedPlanGrid({ cards }: { cards: Array<{ t: string; tag: string; d: string }> }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    grid.dataset.motion = "ready";
    grid.dataset.revealStep = "0";
    grid.dataset.revealCycle = "0";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      grid.dataset.revealStep = "3";
      grid.dataset.visible = "true";
      return;
    }

    const revealTimers: number[] = [];
    let isInsideViewport = false;
    let revealCycle = 0;

    const clearRevealTimers = () => {
      revealTimers.splice(0).forEach((timer) => window.clearTimeout(timer));
    };

    const startReveal = () => {
      if (isInsideViewport) return;
      isInsideViewport = true;
      revealCycle += 1;
      grid.dataset.revealCycle = String(revealCycle);
      grid.dataset.revealStep = "1";
      revealTimers.push(
        window.setTimeout(() => { grid.dataset.revealStep = "2"; }, 520),
        window.setTimeout(() => {
          grid.dataset.revealStep = "3";
          grid.dataset.visible = "true";
        }, 1040),
      );
    };

    const resetReveal = () => {
      if (!isInsideViewport) return;
      isInsideViewport = false;
      clearRevealTimers();
      grid.dataset.revealStep = "0";
      delete grid.dataset.visible;
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) startReveal();
        else resetReveal();
      },
      { threshold: 0, rootMargin: "0px 0px -6%" },
    );
    let observeFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      observeFrame = window.requestAnimationFrame(() => observer.observe(grid));
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(observeFrame);
      clearRevealTimers();
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={gridRef} className={styles.planGrid} data-testid="sequenced-plan-grid">
      {cards.map((card, index) => (
        <article key={card.t} className={index === 1 ? styles.planFeatured : ""} data-reveal-order={index + 1}>
          <span className={styles.planIndex}>0{index + 1}</span>
          <h3>{card.t}</h3>
          <strong>{card.tag}</strong>
          <p>{card.d}</p>
        </article>
      ))}
    </div>
  );
}

export function HomeMarketingPage() {
  const [lang] = useLanguage();
  const t = homeCopy[lang];
  return (
    <main className={styles.page}>
      <MarketingNav lang={lang} page="home" />
      <section className={styles.hero}>
        <div className={styles.heroAura} />
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <Eyebrow>{t.hero.eyebrow}</Eyebrow>
            <h1>{t.hero.titleA} <span>{t.hero.titleB}</span></h1>
            <p>{t.hero.lead}</p>
            <div className={styles.actions}><Link className={styles.primaryButton} href="/instagram-growth">{t.hero.primary}<Arrow /></Link><Link className={styles.secondaryButton} href="/ai-automation">{t.hero.secondary}</Link></div>
            <div className={styles.checks}>{t.hero.checks.map((check) => <span key={check}>✓ {check}</span>)}</div>
          </div>
          <DynamicInstagramPreview lang={lang} />
        </div>
      </section>

      <section className={styles.proof} id="results">
        <p>{t.proof.line}</p>
        <div>{t.proof.metrics.map((metric) => <article key={metric.l}><strong>{metric.n}</strong><span>{metric.l}</span></article>)}</div>
      </section>

      <section className={`${styles.section} ${styles.homeSectionMuted}`}>
        <div className={`${styles.integratedVisual} ${styles.acquisitionVisual}`} data-testid="smart-acquisition-visual">
          <Image src="/homepage/assets/smart-acquisition-refinery-v1.jpg" alt={t.why.visualAlt} width={1672} height={941} sizes="(max-width: 820px) calc(100vw - 32px), 1180px" />
          <div className={styles.integratedIntro}><Eyebrow>{t.why.eyebrow}</Eyebrow><h2>{t.why.title}</h2><p>{t.why.lead}</p></div>
          <div className={styles.acquisitionSweep} aria-hidden="true" />
          <div className={styles.acquisitionSupervision}><i aria-hidden="true" />{t.why.supervision}</div>
          <div className={styles.integratedNarrative}>
            {t.why.cards.map((card) => <article key={card.n}><span>{card.n}</span><h3>{card.t}</h3><p>{card.d}</p></article>)}
          </div>
          <div className={styles.acquisitionFlow} aria-hidden="true">
            {t.why.flow.map((label, index) => <span key={label} data-stage={index + 1}>{label}</span>)}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.useSection}`}>
        <div className={`${styles.integratedVisual} ${styles.adaptiveVisual}`} data-testid="adaptive-growth-visual">
          <Image src="/homepage/assets/adaptive-growth-engine-v1.jpg" alt={t.uses.visualAlt} width={1672} height={941} sizes="(max-width: 820px) calc(100vw - 32px), 1180px" />
          <div className={styles.integratedIntro}><Eyebrow>{t.uses.eyebrow}</Eyebrow><h2>{t.uses.title}</h2></div>
          <div className={styles.integratedUseCases}>
            {t.uses.cards.map((card, index) => <article key={card.t}><span>0{index + 1}</span><h3>{card.t}</h3><p>{card.d}</p></article>)}
          </div>
          <div className={styles.adaptiveFlow} aria-hidden="true">
            {t.uses.flow.map((label) => <span key={label}>{label}</span>)}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.homeSectionDeep}`} id="plans">
        <div className={styles.sectionHead}><Eyebrow>{t.plans.eyebrow}</Eyebrow><h2>{t.plans.title}</h2><p>{t.plans.lead}</p></div>
        <SequencedPlanGrid cards={t.plans.cards} />
        <div className={styles.centerAction}><Link className={styles.primaryButton} href="/instagram-growth#pricing">{t.plans.cta}<Arrow /></Link></div>
      </section>

      <section className={styles.beyond}>
        <div><Eyebrow>{t.beyond.eyebrow}</Eyebrow><h2>{t.beyond.title}</h2><p>{t.beyond.lead}</p><Link className={styles.secondaryButton} href="/ai-automation">{t.beyond.cta}<Arrow /></Link></div>
        <div className={styles.beyondList}>{t.beyond.items.map((item, index) => <div key={item}><span>0{index + 1}</span><strong>{item}</strong><i>↗</i></div>)}</div>
      </section>

      <section className={`${styles.section} ${styles.homeSectionMuted}`}>
        <div className={styles.sectionHead}><Eyebrow>{t.stories.eyebrow}</Eyebrow><h2>{t.stories.title}</h2></div>
        <div className={styles.quoteGrid}>{t.stories.quotes.map((quote) => <article key={quote.n}><div className={styles.stars}>★★★★★</div><blockquote>“{quote.q}”</blockquote><div className={styles.person}><Image src={quote.img} alt="" width={48} height={48} /><span><strong>{quote.n}</strong><small>{quote.s}</small></span></div></article>)}</div>
      </section>

      <section className={styles.finalCta}><Eyebrow>{t.final.eyebrow}</Eyebrow><h2>{t.final.title}</h2><div className={styles.actions}><Link className={styles.primaryButton} href="/instagram-growth">{t.final.primary}<Arrow /></Link><a className={styles.secondaryButton} href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">{t.final.secondary}</a></div></section>
      <SiteFooter lang={lang} />
    </main>
  );
}

export function AiAutomationMarketingPage() {
  const [lang] = useLanguage();
  const t = automationCopy[lang];
  return (
    <main className={`${styles.page} ${styles.automationPage}`}>
      <MarketingNav lang={lang} page="automation" />
      <section className={`${styles.hero} ${styles.automationHero}`}>
        <div className={styles.heroAura} />
        <div className={styles.automationHeroInner}>
          <span className={styles.secondaryBadge}>{t.hero.badge}</span><Eyebrow>{t.hero.eyebrow}</Eyebrow>
          <h1>{t.hero.title}</h1><p>{t.hero.lead}</p>
          <div className={styles.actions}><a className={styles.primaryButton} href="#systems">{t.hero.primary}<Arrow /></a><Link className={styles.secondaryButton} href="/instagram-growth">{t.hero.secondary}</Link></div>
        </div>
      </section>

      <section className={styles.section} id="systems">
        <div className={styles.sectionHead}><Eyebrow>{t.systems.eyebrow}</Eyebrow><h2>{t.systems.title}</h2><p>{t.systems.lead}</p></div>
        <div className={styles.systemGrid}>{t.systems.cards.map((card) => <article key={card.k}><span>{card.k}</span><h3>{card.t}</h3><p>{card.d}</p><Link href={card.href}>{card.link}<Arrow /></Link></article>)}</div>
      </section>

      <section className={styles.orchestration}>
        <div><Eyebrow>{t.canvas.eyebrow}</Eyebrow><h2>{t.canvas.title}</h2></div>
        <div className={styles.orchestrationMap}>
          <div>{t.canvas.nodes.map((node) => <span key={node}>{node}</span>)}</div><strong>{t.canvas.center}<i /></strong><div>{t.canvas.outputs.map((output) => <span key={output}>{output}</span>)}</div>
        </div>
      </section>

      <section className={styles.section} id="method">
        <div className={styles.sectionHead}><Eyebrow>{t.method.eyebrow}</Eyebrow><h2>{t.method.title}</h2></div>
        <div className={styles.methodGrid}>{t.method.steps.map((step) => <article key={step.n}><span>{step.n}</span><h3>{step.t}</h3><p>{step.d}</p></article>)}</div>
      </section>

      <section className={styles.fitSection}><div><Eyebrow>{t.fit.eyebrow}</Eyebrow><h2>{t.fit.title}</h2></div><div>{t.fit.items.map((item) => <span key={item}>✓ {item}</span>)}</div></section>

      <section className={styles.flagship}><div><Eyebrow>{t.primary.eyebrow}</Eyebrow><h2>{t.primary.title}</h2><p>{t.primary.lead}</p><Link className={styles.primaryButton} href="/instagram-growth">{t.primary.cta}<Arrow /></Link></div><DynamicInstagramPreview lang={lang} /></section>

      <section className={styles.finalCta}><Eyebrow>{t.final.eyebrow}</Eyebrow><h2>{t.final.title}</h2><div className={styles.actions}><a className={styles.primaryButton} href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">{t.final.primary}<Arrow /></a><Link className={styles.secondaryButton} href="/contact">{t.final.secondary}</Link></div></section>
      <SiteFooter lang={lang} />
    </main>
  );
}
