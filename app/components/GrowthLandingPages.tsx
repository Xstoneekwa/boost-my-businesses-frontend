"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import styles from "./GrowthLandingPages.module.css";

type Lang = "fr" | "en";
type Copy = { fr: string; en: string };

const HOME_URL = "https://www.boostmybusinesses.com";
const PRICING_URL = "/instagram-growth#pricing";
const CALENDLY_URL = "https://calendly.com/boostmybusinesses/discovertheassistant";
const LANGUAGE_KEY = "boost_ai_landing_lang_v1";
const LANGUAGE_EVENT = "bmb-language-change";

type VerticalKey = "real-estate" | "beauty-aesthetics" | "restaurants" | "fitness";

type VerticalConfig = {
  label: Copy;
  hero: Copy;
  lead: Copy;
  challenge: Copy;
  challengeLead: Copy;
  outcomes: Copy[];
  sources: Copy[];
  funnel: Copy[];
  strategyTitle: Copy;
  strategyLead: Copy;
  strategyCards: { title: Copy; text: Copy }[];
  saExample: Copy;
  faq: { q: Copy; a: Copy }[];
};

const verticals: Record<VerticalKey, VerticalConfig> = {
  "real-estate": {
    label: { en: "Real estate", fr: "Immobilier" },
    hero: { en: "Instagram growth built for real-estate businesses", fr: "Une croissance Instagram conçue pour l’immobilier" },
    lead: { en: "Build a relevant audience around the places, properties and lifestyles your buyers and sellers already follow.", fr: "Construisez une audience pertinente autour des lieux, biens et styles de vie que vos acheteurs et vendeurs suivent déjà." },
    challenge: { en: "Property attention starts long before the enquiry", fr: "L’attention immobilière commence bien avant la demande" },
    challengeLead: { en: "Potential clients discover neighbourhoods, developers and local experts every day. We help your profile appear naturally inside that discovery journey.", fr: "Les prospects découvrent chaque jour des quartiers, promoteurs et experts locaux. Nous aidons votre profil à entrer naturellement dans ce parcours." },
    outcomes: [
      { en: "Create awareness around active mandates and developments", fr: "Créer de la visibilité autour des mandats et projets actifs" },
      { en: "Reach owners, movers and property-minded local audiences", fr: "Toucher propriétaires, futurs résidents et audiences locales intéressées" },
      { en: "Turn stronger profile discovery into enquiries over time", fr: "Transformer une meilleure découverte du profil en demandes" },
    ],
    sources: [
      { en: "Neighbourhood and community pages", fr: "Pages de quartiers et communautés" },
      { en: "Developers and competing agents", fr: "Promoteurs et agents concurrents" },
      { en: "Mortgage and property-finance accounts", fr: "Comptes de crédit et finance immobilière" },
      { en: "Interior design and architecture", fr: "Design intérieur et architecture" },
      { en: "Local premium lifestyle accounts", fr: "Comptes lifestyle premium locaux" },
      { en: "Property publications and communities", fr: "Médias et communautés immobilières" },
    ],
    funnel: [
      { en: "Target audience", fr: "Audience cible" },
      { en: "Profile discovery", fr: "Découverte du profil" },
      { en: "Follow", fr: "Abonnement" },
      { en: "Property content", fr: "Contenu immobilier" },
      { en: "DM or enquiry", fr: "DM ou demande" },
    ],
    strategyTitle: { en: "A campaign mapped to your actual property market", fr: "Une campagne alignée sur votre marché immobilier réel" },
    strategyLead: { en: "Targeting can combine location, market position and complementary interests without pretending that a postcode alone proves buying intent.", fr: "Le ciblage peut combiner localisation, positionnement et intérêts complémentaires sans prétendre qu’un code postal prouve une intention d’achat." },
    strategyCards: [
      { title: { en: "Agents & agencies", fr: "Agents & agences" }, text: { en: "Build recognition around your territory, expertise and current stock.", fr: "Développez votre notoriété autour de votre territoire, expertise et portefeuille." } },
      { title: { en: "Developers", fr: "Promoteurs" }, text: { en: "Connect developments with audiences already engaging with place and lifestyle content.", fr: "Reliez les projets aux audiences déjà engagées avec les lieux et le lifestyle." } },
      { title: { en: "Property services", fr: "Services immobiliers" }, text: { en: "Reach adjacent audiences across finance, design, relocation and ownership.", fr: "Touchez les audiences voisines de la finance, du design, de la mobilité et de la propriété." } },
    ],
    saExample: { en: "South Africa example: a Sandton agent can build targeting around neighbourhood pages, developers, mortgage specialists and complementary local businesses.", fr: "Exemple Afrique du Sud : un agent de Sandton peut structurer son ciblage autour des pages de quartier, promoteurs, spécialistes du crédit et entreprises locales complémentaires." },
    faq: [
      { q: { en: "Can you target a specific property market?", fr: "Pouvez-vous cibler un marché immobilier précis ?" }, a: { en: "Campaign sources can reflect your location, niche and positioning. Geographic relevance is built from credible audience sources, not unsupported precision claims.", fr: "Les sources peuvent refléter votre localisation, niche et positionnement. La pertinence géographique repose sur des sources crédibles, sans promesse de précision non supportée." } },
      { q: { en: "Do you guarantee property enquiries?", fr: "Garantissez-vous des demandes immobilières ?" }, a: { en: "No. We grow relevant discovery and audience quality; your offer, content and follow-up influence enquiries.", fr: "Non. Nous améliorons la découverte pertinente et la qualité de l’audience ; votre offre, contenu et suivi influencent les demandes." } },
    ],
  },
  "beauty-aesthetics": {
    label: { en: "Beauty & aesthetics", fr: "Beauté & esthétique" },
    hero: { en: "Instagram growth for beauty and aesthetics brands", fr: "La croissance Instagram pour les marques beauté et esthétique" },
    lead: { en: "Put your work in front of local audiences who already care about skincare, treatments, wellness and trusted recommendations.", fr: "Présentez votre travail aux audiences locales déjà intéressées par le skincare, les soins, le bien-être et les recommandations fiables." },
    challenge: { en: "Your work is visual. Discovery should be local and relevant.", fr: "Votre travail est visuel. Sa découverte doit être locale et pertinente." },
    challengeLead: { en: "Great results content only performs when the right people find it. BMB builds the audience layer around your services and location.", fr: "Même un excellent contenu de résultats a besoin de la bonne audience. BMB construit cette audience autour de vos services et de votre zone." },
    outcomes: [
      { en: "Increase discovery of treatment and transformation content", fr: "Accroître la découverte des contenus de soins et transformations" },
      { en: "Build familiarity before a booking decision", fr: "Créer de la familiarité avant une décision de réservation" },
      { en: "Support Welcome DM and enquiry journeys on eligible plans", fr: "Soutenir les parcours Welcome DM et demandes sur les offres éligibles" },
    ],
    sources: [
      { en: "Salons and complementary specialists", fr: "Salons et spécialistes complémentaires" },
      { en: "Skincare and aesthetics communities", fr: "Communautés skincare et esthétique" },
      { en: "Bridal and occasion accounts", fr: "Comptes mariage et événements" },
      { en: "Wellness businesses", fr: "Entreprises de bien-être" },
      { en: "Local lifestyle creators", fr: "Créateurs lifestyle locaux" },
      { en: "Relevant beauty brands", fr: "Marques beauté pertinentes" },
    ],
    funnel: [
      { en: "Local audience", fr: "Audience locale" },
      { en: "Profile discovery", fr: "Découverte du profil" },
      { en: "Follow", fr: "Abonnement" },
      { en: "Before / after content", fr: "Contenu avant / après" },
      { en: "Welcome DM", fr: "Welcome DM" },
      { en: "Booking or enquiry", fr: "Réservation ou demande" },
    ],
    strategyTitle: { en: "Targeting that reflects trust, treatment and lifestyle", fr: "Un ciblage qui combine confiance, soins et lifestyle" },
    strategyLead: { en: "Campaigns can connect service categories with local interest ecosystems while keeping activity natural and managed.", fr: "Les campagnes relient les catégories de services aux écosystèmes d’intérêt locaux avec une activité naturelle et gérée." },
    strategyCards: [
      { title: { en: "Salons", fr: "Salons" }, text: { en: "Reach people engaging with hair, nails, makeup and local style.", fr: "Touchez les personnes intéressées par coiffure, ongles, maquillage et style local." } },
      { title: { en: "Aesthetics clinics", fr: "Cliniques esthétiques" }, text: { en: "Build educated discovery around services, practitioners and care.", fr: "Développez une découverte informée autour des soins et praticiens." } },
      { title: { en: "Wellness brands", fr: "Marques bien-être" }, text: { en: "Connect routines and outcomes with an aligned lifestyle audience.", fr: "Reliez routines et résultats à une audience lifestyle cohérente." } },
    ],
    saExample: { en: "South Africa example: a Cape Town skincare studio can combine Sea Point lifestyle pages, bridal creators and complementary wellness businesses as targeting sources.", fr: "Exemple Afrique du Sud : un studio skincare du Cap peut combiner pages lifestyle de Sea Point, créateurs bridal et entreprises bien-être complémentaires." },
    faq: [
      { q: { en: "Can this support local bookings?", fr: "Cela peut-il soutenir les réservations locales ?" }, a: { en: "The campaign improves relevant local discovery. Your availability, content and booking path remain important conversion factors.", fr: "La campagne améliore la découverte locale pertinente. Vos disponibilités, contenus et parcours de réservation restent déterminants." } },
      { q: { en: "Is Welcome DM included?", fr: "Le Welcome DM est-il inclus ?" }, a: { en: "Welcome DM is available only on eligible plans. The pricing page shows the current plan features.", fr: "Le Welcome DM est disponible uniquement sur les offres éligibles. La page tarifaire présente les fonctionnalités actuelles." } },
    ],
  },
  restaurants: {
    label: { en: "Restaurants", fr: "Restaurants" },
    hero: { en: "Turn local Instagram attention into restaurant discovery", fr: "Transformez l’attention Instagram locale en découverte de votre restaurant" },
    lead: { en: "Build a nearby audience around your food, atmosphere, neighbourhood and the moments that make people want to visit.", fr: "Construisez une audience de proximité autour de votre cuisine, ambiance, quartier et des moments qui donnent envie de venir." },
    challenge: { en: "People choose places they recognise and remember", fr: "Les clients choisissent les lieux qu’ils reconnaissent et retiennent" },
    challengeLead: { en: "Instagram is often where the next lunch, date night or weekend plan begins. Relevant audience growth keeps your restaurant in that consideration set.", fr: "Instagram est souvent le point de départ du prochain déjeuner, dîner ou week-end. Une audience pertinente maintient votre établissement dans les options envisagées." },
    outcomes: [
      { en: "Reach people already exploring local food and places", fr: "Toucher les personnes qui explorent déjà les lieux et la gastronomie locale" },
      { en: "Give reels, menus and stories a more relevant audience", fr: "Donner aux reels, menus et stories une audience plus pertinente" },
      { en: "Support visits, bookings and direct enquiries", fr: "Soutenir visites, réservations et demandes directes" },
    ],
    sources: [
      { en: "Food bloggers and local creators", fr: "Blogueurs food et créateurs locaux" },
      { en: "Neighbouring and complementary restaurants", fr: "Restaurants voisins et complémentaires" },
      { en: "Hotels, tourism and hospitality", fr: "Hôtels, tourisme et hospitality" },
      { en: "Nightlife and venue pages", fr: "Pages nightlife et lieux" },
      { en: "Local media and event accounts", fr: "Médias et événements locaux" },
      { en: "Neighbourhood communities", fr: "Communautés de quartier" },
    ],
    funnel: [
      { en: "Local audience", fr: "Audience locale" },
      { en: "Restaurant profile", fr: "Profil du restaurant" },
      { en: "Reels, menu and stories", fr: "Reels, menu et stories" },
      { en: "Follow", fr: "Abonnement" },
      { en: "Visit, booking or enquiry", fr: "Visite, réservation ou demande" },
    ],
    strategyTitle: { en: "Built around your neighbourhood and dining identity", fr: "Construit autour de votre quartier et identité culinaire" },
    strategyLead: { en: "A strong restaurant campaign combines proximity with cuisine, occasion and complementary local communities.", fr: "Une campagne restaurant forte combine proximité, cuisine, occasion et communautés locales complémentaires." },
    strategyCards: [
      { title: { en: "Neighbourhood demand", fr: "Demande de proximité" }, text: { en: "Build familiarity among people already following your local area.", fr: "Créez de la familiarité auprès des personnes qui suivent déjà votre quartier." } },
      { title: { en: "Food discovery", fr: "Découverte food" }, text: { en: "Connect menu content with creators, publications and dining interests.", fr: "Reliez vos menus aux créateurs, médias et intérêts culinaires." } },
      { title: { en: "Occasions", fr: "Occasions" }, text: { en: "Reach audiences planning evenings, weekends, travel and celebrations.", fr: "Touchez les audiences qui planifient sorties, week-ends, voyages et célébrations." } },
    ],
    saExample: { en: "South Africa example: an Umhlanga restaurant can map targeting around Durban food creators, hotels, local events and nearby lifestyle communities.", fr: "Exemple Afrique du Sud : un restaurant d’Umhlanga peut cibler autour des créateurs food de Durban, hôtels, événements et communautés lifestyle proches." },
    faq: [
      { q: { en: "Does this replace restaurant advertising?", fr: "Cela remplace-t-il la publicité du restaurant ?" }, a: { en: "No. It is a managed audience-growth channel that can complement content, partnerships and paid campaigns.", fr: "Non. C’est un canal de croissance d’audience géré qui complète contenus, partenariats et campagnes payantes." } },
      { q: { en: "Can multi-location restaurants use it?", fr: "Les restaurants multi-sites peuvent-ils l’utiliser ?" }, a: { en: "Yes. Target sources can reflect each location, subject to the account and campaign setup.", fr: "Oui. Les sources peuvent refléter chaque zone, selon la configuration du compte et de la campagne." } },
    ],
  },
  fitness: {
    label: { en: "Fitness", fr: "Fitness" },
    hero: { en: "Instagram growth for fitness communities and coaches", fr: "La croissance Instagram pour les communautés fitness et coachs" },
    lead: { en: "Reach people who already follow movement, training, wellness and the local communities that keep them motivated.", fr: "Touchez les personnes qui suivent déjà le sport, l’entraînement, le bien-être et les communautés locales qui les motivent." },
    challenge: { en: "Fitness growth is built on identity and consistency", fr: "La croissance fitness repose sur l’identité et la régularité" },
    challengeLead: { en: "People join when they can picture themselves in the experience. A relevant audience gives your coaching, classes and community content more chances to connect.", fr: "Les personnes s’engagent lorsqu’elles se projettent dans l’expérience. Une audience pertinente donne plus d’impact à vos contenus de coaching, cours et communauté." },
    outcomes: [
      { en: "Grow recognition around a gym, coach or programme", fr: "Développer la notoriété d’une salle, d’un coach ou d’un programme" },
      { en: "Reach aligned sports and wellness communities", fr: "Toucher des communautés sport et bien-être cohérentes" },
      { en: "Support trial, membership and coaching enquiries", fr: "Soutenir les demandes d’essai, d’adhésion et de coaching" },
    ],
    sources: [
      { en: "Gyms and specialist studios", fr: "Salles et studios spécialisés" },
      { en: "Personal trainers and coaches", fr: "Personal trainers et coachs" },
      { en: "Run clubs and sports communities", fr: "Run clubs et communautés sportives" },
      { en: "Wellness and recovery accounts", fr: "Comptes bien-être et récupération" },
      { en: "Fitness creators", fr: "Créateurs fitness" },
      { en: "Healthy lifestyle businesses", fr: "Entreprises healthy lifestyle" },
    ],
    funnel: [
      { en: "Local or niche audience", fr: "Audience locale ou niche" },
      { en: "Profile discovery", fr: "Découverte du profil" },
      { en: "Follow", fr: "Abonnement" },
      { en: "Training content", fr: "Contenu d’entraînement" },
      { en: "Trial, membership or coaching enquiry", fr: "Demande d’essai, adhésion ou coaching" },
    ],
    strategyTitle: { en: "Match the audience to the way you help people move", fr: "Alignez l’audience avec votre façon de faire bouger les gens" },
    strategyLead: { en: "From community-led gyms to specialist coaching, sources are selected around the discipline, location and member profile.", fr: "Des salles communautaires au coaching spécialisé, les sources sont choisies selon la discipline, la zone et le profil membre." },
    strategyCards: [
      { title: { en: "Gyms & studios", fr: "Salles & studios" }, text: { en: "Build local recognition around classes, equipment and community.", fr: "Développez la notoriété locale des cours, équipements et de la communauté." } },
      { title: { en: "Coaches", fr: "Coachs" }, text: { en: "Put expertise and client journeys in front of an aligned niche.", fr: "Exposez votre expertise et vos parcours clients à une niche cohérente." } },
      { title: { en: "Clubs & communities", fr: "Clubs & communautés" }, text: { en: "Grow around shared disciplines, events and consistent participation.", fr: "Grandissez autour des disciplines, événements et de la participation régulière." } },
    ],
    saExample: { en: "South Africa example: a Pretoria coach can combine Centurion gyms, local run clubs, sports communities and complementary wellness accounts.", fr: "Exemple Afrique du Sud : un coach de Pretoria peut combiner salles de Centurion, run clubs locaux, communautés sportives et comptes bien-être complémentaires." },
    faq: [
      { q: { en: "Can targeting reflect a fitness niche?", fr: "Le ciblage peut-il refléter une niche fitness ?" }, a: { en: "Yes. Campaign sources can be built around disciplines, locations, communities and complementary interests.", fr: "Oui. Les sources peuvent être structurées autour des disciplines, zones, communautés et intérêts complémentaires." } },
      { q: { en: "Do you guarantee memberships?", fr: "Garantissez-vous des adhésions ?" }, a: { en: "No. We improve relevant audience discovery; your offer, experience and follow-up determine conversion.", fr: "Non. Nous améliorons la découverte par une audience pertinente ; votre offre, expérience et suivi déterminent la conversion." } },
    ],
  },
};

function subscribeLanguage(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(LANGUAGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(LANGUAGE_EVENT, callback);
  };
}

function useLanguage() {
  const lang = useSyncExternalStore(
    subscribeLanguage,
    () => (window.localStorage.getItem(LANGUAGE_KEY) === "fr" ? "fr" : "en"),
    () => "en" as Lang,
  );
  const setLang = (next: Lang) => {
    window.localStorage.setItem(LANGUAGE_KEY, next);
    window.dispatchEvent(new Event(LANGUAGE_EVENT));
  };
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return [lang, setLang] as const;
}

function pick(copy: Copy, lang: Lang) {
  return copy[lang];
}

function Brand() {
  return (
    <Link className={styles.brand} href={HOME_URL} aria-label="Boost My Businesses">
      <Image src="/instagram-growth/assets/icon-square-256.png" alt="" width={40} height={40} aria-hidden="true" />
      <span>Boost<span>My</span>Businesses</span>
    </Link>
  );
}

function Header({ lang, setLang }: { lang: Lang; setLang: (lang: Lang) => void }) {
  const fr = lang === "fr";
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Brand />
        <nav aria-label={fr ? "Navigation principale" : "Main navigation"}>
          <Link href="/instagram-growth">Instagram Growth</Link>
          <a href="#how">{fr ? "Méthode" : "How it works"}</a>
          <a href="#audiences">{fr ? "Audiences" : "Audiences"}</a>
        </nav>
        <div className={styles.headerActions}>
          <div className={styles.language} aria-label="Language">
            {(["fr", "en"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={lang === option} className={lang === option ? styles.activeLanguage : ""} onClick={() => setLang(option)}>{option.toUpperCase()}</button>
            ))}
          </div>
          <a className={styles.headerCta} href={PRICING_URL}>{fr ? "Voir les offres" : "View plans"}</a>
        </div>
      </div>
    </header>
  );
}

function Footer({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <footer className={styles.footer}>
      <div><Brand /><p>{fr ? "Croissance Instagram ciblée, opérée depuis de vrais téléphones et gérée par notre équipe." : "Targeted Instagram growth, operated from real phones and managed by our team."}</p></div>
      <div><strong>{fr ? "Explorer" : "Explore"}</strong><Link href="/instagram-growth-south-africa">South Africa</Link>{(Object.keys(verticals) as VerticalKey[]).map((key) => <Link key={key} href={`/instagram-growth/${key}`}>{pick(verticals[key].label, lang)}</Link>)}</div>
      <div><strong>{fr ? "Actions" : "Actions"}</strong><Link href={PRICING_URL}>{fr ? "Offres" : "Plans"}</Link><a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">{fr ? "Réserver un appel" : "Book a call"}</a><Link href="/instagram-growth">Instagram Growth</Link></div>
    </footer>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className={styles.eyebrow}>{children}</span>;
}

function PricingBridge({ lang }: { lang: Lang }) {
  const fr = lang === "fr";
  return (
    <section className={styles.pricingBridge}>
      <div><Eyebrow>{fr ? "OFFRES INTERNATIONALES" : "INTERNATIONAL PLANS"}</Eyebrow><h2>{fr ? "Des offres à partir de 147 € / mois" : "Plans from €147/month"}</h2><p>{fr ? "Les offres sont facturées en EUR. Votre banque gère automatiquement la conversion de devise." : "Plans are billed in EUR. Your bank handles currency conversion automatically."}</p></div>
      <a className={styles.primaryButton} href={PRICING_URL}>{fr ? "Voir les offres" : "Explore plans"}<span aria-hidden="true">↗</span></a>
    </section>
  );
}

function FinalCta({ lang, title }: { lang: Lang; title: string }) {
  const fr = lang === "fr";
  return (
    <section className={styles.finalCta}>
      <Eyebrow>{fr ? "PRÊT À CONSTRUIRE UNE AUDIENCE PERTINENTE ?" : "READY TO BUILD A RELEVANT AUDIENCE?"}</Eyebrow>
      <h2>{title}</h2>
      <div><a className={styles.primaryButton} href={PRICING_URL}>{fr ? "Explorer les offres" : "Explore plans"}<span aria-hidden="true">↗</span></a><a className={styles.secondaryButton} href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">{fr ? "Réserver un appel" : "Book a call"}</a></div>
    </section>
  );
}

export function VerticalGrowthPage({ vertical }: { vertical: VerticalKey }) {
  const [lang, setLang] = useLanguage();
  const t = verticals[vertical];
  const fr = lang === "fr";
  return (
    <main className={`${styles.page} ${styles[`theme_${vertical}`]}`}>
      <Header lang={lang} setLang={setLang} />
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroInner}>
          <div>
            <Eyebrow>INSTAGRAM GROWTH · {pick(t.label, lang).toUpperCase()}</Eyebrow>
            <h1>{pick(t.hero, lang)}</h1>
            <p>{pick(t.lead, lang)}</p>
            <div className={styles.actions}><a className={styles.primaryButton} href={PRICING_URL}>{fr ? "Voir les offres" : "Explore plans"}<span aria-hidden="true">↗</span></a><a className={styles.secondaryButton} href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">{fr ? "Réserver un appel" : "Book a call"}</a></div>
          </div>
          <div className={styles.heroPanel}>
            <span>{fr ? "PARCOURS D’ACQUISITION" : "ACQUISITION JOURNEY"}</span>
            {t.funnel.map((step, index) => <div key={step.en}><i>0{index + 1}</i><strong>{pick(step, lang)}</strong></div>)}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.lightBand}`}>
        <div className={styles.sectionHead}><Eyebrow>{fr ? "L’ENJEU" : "THE OPPORTUNITY"}</Eyebrow><h2>{pick(t.challenge, lang)}</h2><p>{pick(t.challengeLead, lang)}</p></div>
        <div className={styles.outcomeGrid}>{t.outcomes.map((item, index) => <article key={item.en}><span>0{index + 1}</span><p>{pick(item, lang)}</p></article>)}</div>
      </section>

      <section className={styles.section} id="audiences">
        <div className={styles.splitHead}><div><Eyebrow>{fr ? "SOURCES D’AUDIENCE" : "AUDIENCE SOURCES"}</Eyebrow><h2>{fr ? "Des signaux pertinents, pas une audience générique." : "Relevant signals, not a generic audience."}</h2></div><p>{fr ? "Chaque source est évaluée selon votre niche, votre localisation et la cohérence de son audience." : "Each source is assessed against your niche, location and the relevance of its audience."}</p></div>
        <div className={styles.sourceGrid}>{t.sources.map((source, index) => <div key={source.en}><span>{String(index + 1).padStart(2, "0")}</span>{pick(source, lang)}</div>)}</div>
      </section>

      <section className={`${styles.section} ${styles.strategyBand}`} id="how">
        <div className={styles.sectionHead}><Eyebrow>{fr ? "STRATÉGIE GÉRÉE" : "MANAGED STRATEGY"}</Eyebrow><h2>{pick(t.strategyTitle, lang)}</h2><p>{pick(t.strategyLead, lang)}</p></div>
        <div className={styles.cardGrid}>{t.strategyCards.map((card) => <article key={card.title.en}><h3>{pick(card.title, lang)}</h3><p>{pick(card.text, lang)}</p></article>)}</div>
      </section>

      <section className={styles.infrastructure}>
        <div><Eyebrow>{fr ? "INFRASTRUCTURE RÉELLE" : "REAL INFRASTRUCTURE"}</Eyebrow><h2>{fr ? "De vrais téléphones. Une activité naturelle. Une équipe aux commandes." : "Real phones. Natural activity. A team in control."}</h2></div>
        <div className={styles.infrastructureList}><span>{fr ? "Rythmes progressifs adaptés au compte" : "Progressive pacing adapted to the account"}</span><span>{fr ? "Campagnes supervisées et optimisées" : "Campaigns supervised and optimized"}</span><span>{fr ? "Ciblage fondé sur des sources concrètes" : "Targeting built from concrete sources"}</span></div>
      </section>

      <section className={styles.example}><span>{fr ? "EXEMPLE DE CIBLAGE — PAS UN RÉSULTAT CLIENT" : "TARGETING EXAMPLE — NOT A CLIENT RESULT"}</span><p>{pick(t.saExample, lang)}</p><Link href="/instagram-growth-south-africa">{fr ? "Explorer la landing South Africa" : "Explore the South Africa landing"} →</Link></section>

      <PricingBridge lang={lang} />

      <section className={styles.section}>
        <div className={styles.sectionHead}><Eyebrow>FAQ</Eyebrow><h2>{fr ? `Questions sur Instagram Growth pour ${pick(t.label, lang).toLowerCase()}` : `Instagram growth for ${pick(t.label, lang).toLowerCase()}: questions`}</h2></div>
        <div className={styles.faqGrid}>{t.faq.map((item) => <article key={item.q.en}><h3>{pick(item.q, lang)}</h3><p>{pick(item.a, lang)}</p></article>)}</div>
      </section>

      <FinalCta lang={lang} title={fr ? "Développez une audience qui correspond à votre activité." : "Grow an audience that fits your business."} />
      <Footer lang={lang} />
    </main>
  );
}

const saCities = [
  { city: "Johannesburg", places: "Sandton · Rosebank · Fourways · Midrand · Bryanston", text: "Business hubs, premium lifestyle, property, hospitality and specialist services." },
  { city: "Cape Town", places: "CBD · Sea Point · Camps Bay · Stellenbosch · Century City", text: "Tourism, food, design, wellness, property and creator-led communities." },
  { city: "Durban", places: "Umhlanga · Durban North · Berea · Ballito", text: "Hospitality, coastal lifestyle, food, fitness and local business ecosystems." },
  { city: "Pretoria", places: "Menlyn · Brooklyn · Centurion · Hatfield", text: "Professional services, property, education, wellness and sports communities." },
  { city: "Winelands & tourism", places: "Stellenbosch · Franschhoek · Garden Route · safari corridors", text: "Food, wine, hospitality and travel audiences can combine South African and international discovery sources." },
];

export function SouthAfricaGrowthPage() {
  const [lang, setLang] = useLanguage();
  const fr = lang === "fr";
  const industries: { key: VerticalKey; text: Copy }[] = [
    { key: "real-estate", text: { en: "Build recognition around neighbourhoods, developments and local property intent.", fr: "Développez votre notoriété autour des quartiers, projets et signaux d’intérêt immobilier." } },
    { key: "beauty-aesthetics", text: { en: "Reach local skincare, wellness, bridal and lifestyle audiences.", fr: "Touchez les audiences locales skincare, bien-être, mariage et lifestyle." } },
    { key: "restaurants", text: { en: "Connect food, atmosphere and location with people choosing where to go.", fr: "Reliez cuisine, ambiance et lieu aux personnes qui choisissent où sortir." } },
    { key: "fitness", text: { en: "Grow around gyms, coaches, clubs and active local communities.", fr: "Grandissez autour des salles, coachs, clubs et communautés actives locales." } },
  ];
  return (
    <main className={`${styles.page} ${styles.saPage}`}>
      <Header lang={lang} setLang={setLang} />
      <section className={`${styles.hero} ${styles.saHero}`}>
        <div className={styles.heroGlow} />
        <div className={styles.heroInner}>
          <div><Eyebrow>SOUTH AFRICA · INSTAGRAM GROWTH</Eyebrow><h1>{fr ? "La croissance Instagram pour les entreprises sud-africaines" : "Instagram growth for South African businesses"}</h1><p>{fr ? "Une croissance réelle, ciblée et géographiquement pertinente, propulsée par l’IA et opérée depuis de vrais téléphones — tout en restant entièrement gérée par notre équipe." : "Real, targeted, geo-relevant Instagram growth powered by AI and real phones — fully managed by our team."}</p><div className={styles.actions}><a className={styles.primaryButton} href={PRICING_URL}>{fr ? "Explorer les offres" : "Explore plans"}<span aria-hidden="true">↗</span></a><a className={styles.secondaryButton} href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">{fr ? "Réserver un appel" : "Book a call"}</a></div></div>
          <div className={`${styles.heroPanel} ${styles.mapPanel}`}><span>{fr ? "PERTINENCE LOCALE" : "LOCAL RELEVANCE"}</span><strong>South Africa</strong><p>Johannesburg · Cape Town · Durban · Pretoria</p><small>{fr ? "Des exemples de sources locales, pas une promesse de ciblage au mètre près." : "Examples of local source markets, not a promise of pinpoint targeting."}</small></div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.lightBand}`}>
        <div className={styles.sectionHead}><Eyebrow>{fr ? "AU-DELÀ DU NOMBRE" : "BEYOND THE NUMBER"}</Eyebrow><h2>{fr ? "Une audience locale pertinente vaut plus qu’un simple compteur d’abonnés." : "A relevant local audience matters more than a follower count."}</h2><p>{fr ? "La croissance utile rapproche votre marque des personnes qui partagent déjà votre marché, votre ville, vos intérêts et vos communautés." : "Useful growth brings your brand closer to people who already share your market, city, interests and communities."}</p></div>
        <div className={styles.outcomeGrid}><article><span>01</span><p>{fr ? "Plus de découverte auprès d’audiences cohérentes" : "More discovery among aligned audiences"}</p></article><article><span>02</span><p>{fr ? "Une base plus solide pour votre contenu et vos offres" : "A stronger audience layer for content and offers"}</p></article><article><span>03</span><p>{fr ? "Une campagne gérée, affinée au fil des signaux" : "A managed campaign refined as signals emerge"}</p></article></div>
      </section>

      <section className={styles.section} id="how">
        <div className={styles.sectionHead}><Eyebrow>{fr ? "COMMENT ÇA FONCTIONNE" : "HOW TARGETING WORKS"}</Eyebrow><h2>{fr ? "Votre marché devient une carte de sources d’audience crédibles." : "Your market becomes a map of credible audience sources."}</h2><p>{fr ? "Nous combinons niche, localisation, concurrents, communautés et signaux d’intérêt pour construire un ciblage concret, puis nous l’optimisons." : "We combine niche, location, competitors, communities and interest signals into a concrete targeting plan, then optimize it."}</p></div>
        <div className={styles.cardGrid}><article><h3>{fr ? "Cartographier" : "Map"}</h3><p>{fr ? "Comprendre l’offre, la zone, l’audience et les concurrents pertinents." : "Understand the offer, service area, audience and relevant competitors."}</p></article><article><h3>{fr ? "Sélectionner" : "Select"}</h3><p>{fr ? "Choisir des sources dont l’audience présente une vraie cohérence." : "Choose sources whose audiences show genuine relevance."}</p></article><article><h3>{fr ? "Optimiser" : "Optimize"}</h3><p>{fr ? "Affiner la campagne selon la qualité des signaux observés." : "Refine the campaign based on the quality of observed signals."}</p></article></div>
      </section>

      <section className={`${styles.section} ${styles.lightBand}`}>
        <div className={styles.splitHead}><div><Eyebrow>{fr ? "SOURCES LOCALES" : "LOCAL AUDIENCE SOURCES"}</Eyebrow><h2>{fr ? "La pertinence géographique vient des écosystèmes ciblés." : "Geographic relevance comes from the ecosystems you target."}</h2></div><p>{fr ? "Instagram ne fournit pas de filtre postal exact. Nous construisons donc la pertinence locale à partir de comptes, lieux et signaux sélectionnés pour votre marché." : "Instagram does not provide an exact postcode filter. We build local relevance from accounts, places and signals selected for your market."}</p></div>
        <div className={styles.sourceGrid}>
          {(fr ? ["Marques sud-africaines", "Créateurs locaux pertinents", "Pages de ville et de quartier", "Médias et lieux locaux", "Entreprises complémentaires", "Événements et communautés"] : ["South African brands", "Relevant local creators", "City and neighbourhood pages", "Local media and venues", "Complementary businesses", "Events and communities"]).map((source, index) => <div key={source}><span>{String(index + 1).padStart(2, "0")}</span>{source}</div>)}
        </div>
      </section>

      <section className={`${styles.section} ${styles.strategyBand}`} id="audiences">
        <div className={styles.sectionHead}><Eyebrow>SOUTH AFRICA TARGETING</Eyebrow><h2>{fr ? "Quatre marchés majeurs. Des écosystèmes locaux différents." : "Four major markets. Different local ecosystems."}</h2><p>{fr ? "Ces zones illustrent comment une campagne peut être structurée autour de lieux et communautés ; elles ne constituent pas une promesse de précision non supportée." : "These areas illustrate how a campaign can be structured around places and communities; they are not a claim of unsupported geographic precision."}</p></div>
        <div className={styles.cityGrid}>{saCities.map((city) => <article key={city.city}><span>{city.city}</span><h3>{city.places}</h3><p>{city.text}</p></article>)}</div>
      </section>

      <section className={styles.section}>
        <div className={styles.splitHead}><div><Eyebrow>{fr ? "SECTEURS" : "INDUSTRIES"}</Eyebrow><h2>{fr ? "Des stratégies adaptées aux parcours d’achat réels." : "Strategies shaped around real customer journeys."}</h2></div><p>{fr ? "Explorez une landing dédiée à chaque verticale, avec sources, funnel et exemples distincts." : "Explore a dedicated landing for each vertical, with distinct sources, funnel and examples."}</p></div>
        <div className={styles.industryGrid}>{industries.map((industry) => <Link key={industry.key} href={`/instagram-growth/${industry.key}`}><span>↗</span><h3>{pick(verticals[industry.key].label, lang)}</h3><p>{pick(industry.text, lang)}</p></Link>)}</div>
      </section>

      <section className={styles.infrastructure}>
        <div><Eyebrow>{fr ? "INFRASTRUCTURE GÉRÉE" : "MANAGED INFRASTRUCTURE"}</Eyebrow><h2>{fr ? "Une technologie internationale, opérée dans des conditions réelles." : "International technology, operated in real-world conditions."}</h2></div>
        <div className={styles.infrastructureList}><span>{fr ? "Agents IA opérant depuis de vrais téléphones" : "AI agents operating from real phones"}</span><span>{fr ? "Rythme naturel et limites adaptées" : "Natural pacing and adapted limits"}</span><span>{fr ? "Supervision et optimisation par notre équipe" : "Supervision and optimization by our team"}</span></div>
      </section>

      <section className={styles.proofBand}><Eyebrow>{fr ? "CE QUE LE PRODUIT EST CONÇU POUR FAIRE" : "WHAT THE PRODUCT IS BUILT TO DO"}</Eyebrow><div><strong>200–800</strong><span>{fr ? "abonnés ciblés / mois selon l’offre produit générale" : "targeted followers / month across the general product range"}</span></div><p>{fr ? "Cette fourchette est une indication produit générale déjà publiée, pas un résultat client sud-africain ni une garantie." : "This is an existing general product range, not a South African client result or a guarantee."}</p></section>

      <PricingBridge lang={lang} />

      <section className={styles.section}>
        <div className={styles.sectionHead}><Eyebrow>SOUTH AFRICA FAQ</Eyebrow><h2>{fr ? "Questions fréquentes" : "Questions from South African businesses"}</h2></div>
        <div className={styles.faqGrid}><article><h3>{fr ? "Les offres sont-elles en rand ?" : "Are plans billed in rand?"}</h3><p>{fr ? "Non. Les offres restent facturées en EUR et votre banque gère automatiquement la conversion." : "No. Plans remain billed in EUR and your bank handles currency conversion automatically."}</p></article><article><h3>{fr ? "Pouvez-vous cibler ma ville ?" : "Can you target my city?"}</h3><p>{fr ? "Nous construisons des sources géographiquement pertinentes autour de votre marché. Nous ne promettons pas une précision que le produit ne peut pas prouver." : "We build geographically relevant sources around your market. We do not promise precision the product cannot substantiate."}</p></article><article><h3>{fr ? "Utilisez-vous de vrais téléphones ?" : "Do you use real phones?"}</h3><p>{fr ? "Oui. L’activité est opérée depuis notre infrastructure de téléphones réels et gérée par notre équipe." : "Yes. Activity runs from our real-phone infrastructure and is managed by our team."}</p></article><article><h3>{fr ? "Est-ce réservé à l’Afrique du Sud ?" : "Is BMB only for South Africa?"}</h3><p>{fr ? "Non. Boost My Businesses reste international ; cette page est une porte d’entrée locale." : "No. Boost My Businesses remains international; this page is a local acquisition entry point."}</p></article></div>
      </section>

      <FinalCta lang={lang} title={fr ? "Faites grandir votre audience en Afrique du Sud avec une campagne réellement gérée." : "Grow your South African audience with a campaign that is genuinely managed."} />
      <Footer lang={lang} />
    </main>
  );
}
