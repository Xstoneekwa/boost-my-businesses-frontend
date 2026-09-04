"use client";

import Image from "next/image";
import Link from "next/link";
import { useMarketingLanguage } from "../components/useMarketingLanguage";
import s from "./PartnersPage.module.css";

const CALL = "https://calendly.com/boostmybusinesses/discovertheassistant";
const copy = {
  en: {
    partner: "AGENCIES & RESELLERS", call: "Book a Partner Call", product: "View Instagram Growth", model: "The model", plans: "View existing plans",
    title: "Add Instagram Growth to your agency.", accent: "Without building the infrastructure.",
    intro: "You own the client relationship. Boost My Businesses operates the growth engine behind the scenes.",
    agency: "Your agency", engine: "BMB operations", clients: "Your clients", accounts: "Their Instagram accounts",
    agencyNote: "The relationship stays with you.", engineNote: "The operational work sits with us.",
    modelTitle: "Your expertise in front. Our engine behind it.",
    modelLead: "Add a managed service to your offer, without turning your agency into an infrastructure team.",
    keep: "YOU KEEP", handle: "BMB HANDLES",
    keepItems: ["Your brand & commercial offer", "The client relationship", "Content & overall strategy", "Client management & account ownership"],
    handleItems: ["Real-phone infrastructure", "Targeting & campaign execution", "Monitoring & optimization", "Operational complexity"],
    modelFoot: "A reseller service model — not a fully white-label software platform.",
    multiLabel: "ONE AGENCY. MULTIPLE ACCOUNTS.", multiTitle: "Separate clients. A clearer overview.",
    multiLead: "Manage linked Instagram accounts from the existing BMB account overview. Keep each account’s plan and operational status in context.",
    examples: ["Local business", "Personal brand", "Online store"], account: "Client account", accountInfo: ["Plan", "Connection", "Campaign"],
    multiFoot: "Illustration of the model, not a live dashboard. Account-level tracking uses the capabilities already available in BMB.",
    economicsLabel: "BUILD ON WHAT YOU ALREADY SELL", economicsTitle: "A recurring service. Not another system to maintain.",
    economicsLead: "Combine Instagram Growth with your content, strategy or account-management service. Your team can focus on clients and sales while BMB runs the growth operation.",
    economicsNote: "Agency pricing is available through our existing volume programme. We’ll review your account mix and the applicable terms together — no separate partner checkout.",
    economicsSmall: "No revenue or performance projection. Your commercial results depend on your offer, clients and execution.",
    who: "FOR TEAMS THAT ALREADY HELP BRANDS GROW", whoTitle: "A new capability for your existing expertise.",
    whoItems: ["Social media agencies", "Digital marketing agencies", "Growth agencies", "Multi-client freelancers", "Local marketing teams", "Consultants & resellers"],
    faqTitle: "A clear partnership starts with clear answers.",
    faq: [
      ["Can I offer BMB as part of my agency’s service?", "Yes. You can include managed Instagram Growth in your commercial offer while BMB handles the growth operation. We’ll clarify responsibilities and the setup during your partner call."],
      ["Who owns the client relationship?", "Your agency keeps the commercial relationship, brand and overall strategy. Clients retain ownership of their Instagram accounts; BMB supports the operational service."],
      ["Do I need to buy or manage phones?", "No. BMB operates the real-phone infrastructure, targeting execution, monitoring and optimization. Your team does not need to build a phone farm or maintain the operational systems."],
      ["Can I manage multiple client accounts?", "Yes. BMB already supports linked accounts with an agency overview, account-level plans and operational statuses. This is the existing BMB experience, not a new partner portal."],
      ["How does agency pricing work?", "The existing volume programme applies according to the current commercial rules and eligible account count. We’ll review the applicable conditions on the call. This page does not introduce new tiers or prices."],
      ["Does BMB speak directly with my clients?", "Your agency remains the commercial point of contact. We agree the onboarding, support and any necessary operational communication with you; this is not a promise that direct contact can never be required."],
      ["Is full white-label available?", "Not in this V1. The reseller service model does not include a custom domain, fully branded dashboard, partner API or automated partner provisioning."],
      ["Can each client use a different BMB plan?", "Accounts can have their own plan within the existing BMB packages. Choose the appropriate service for each client; the existing plan conditions and checkout remain unchanged."],
      ["Where do I see performance?", "Use the existing BMB dashboard and account views for the tracking available on each account. The agency overview helps you identify plans, connection and campaign status. No additional white-label reporting product is promised."],
      ["How do I become a partner?", "Book a partner call. Tell us about your agency, clients and intended service. We’ll review fit, the existing volume programme and the next steps together."],
    ],
    finalLabel: "LET’S BUILD YOUR NEXT SERVICE", finalTitle: "Bring your clients. We’ll bring the operation.", finalLead: "Let’s work out how Instagram Growth fits your agency — before you change your offer.", home: "Home", faqLabel: "PARTNER FAQ", illustration: "Conceptual illustration of an agency connected to a supervised real-phone operation",
  },
  fr: {
    partner: "AGENCES & REVENDEURS", call: "Réserver un appel partenaire", product: "Voir Instagram Growth", model: "Le modèle", plans: "Voir les formules existantes",
    title: "Ajoutez Instagram Growth à votre agence.", accent: "Sans construire l’infrastructure.",
    intro: "Vous gardez la relation client. Boost My Businesses opère le moteur de croissance en arrière-plan.",
    agency: "Votre agence", engine: "Opérations BMB", clients: "Vos clients", accounts: "Leurs comptes Instagram",
    agencyNote: "Vous gardez la relation.", engineNote: "Nous gérons l’opérationnel.",
    modelTitle: "Votre expertise devant. Notre moteur derrière.", modelLead: "Ajoutez un service géré à votre offre, sans transformer votre agence en équipe d’infrastructure.",
    keep: "VOUS GARDEZ", handle: "BMB PREND EN CHARGE",
    keepItems: ["Votre marque & votre offre", "La relation client", "Le contenu & la stratégie globale", "La gestion client & la propriété des comptes"],
    handleItems: ["L’infrastructure de vrais téléphones", "Le ciblage & l’exécution des campagnes", "Le monitoring & l’optimisation", "La complexité opérationnelle"],
    modelFoot: "Un modèle de service revendeur — pas une plateforme logicielle entièrement en marque blanche.",
    multiLabel: "UNE AGENCE. PLUSIEURS COMPTES.", multiTitle: "Des clients distincts. Une vue plus claire.",
    multiLead: "Gérez les comptes Instagram liés depuis la vue d’ensemble BMB existante. Retrouvez la formule et le statut opérationnel propres à chaque compte.",
    examples: ["Commerce local", "Marque personnelle", "Boutique en ligne"], account: "Compte client", accountInfo: ["Formule", "Connexion", "Campagne"],
    multiFoot: "Illustration du modèle, pas un dashboard en direct. Le suivi par compte utilise les capacités déjà disponibles dans BMB.",
    economicsLabel: "COMPLÉTEZ CE QUE VOUS VENDEZ DÉJÀ", economicsTitle: "Un service récurrent. Pas un système de plus à maintenir.",
    economicsLead: "Associez Instagram Growth à vos prestations de contenu, de stratégie ou de gestion de compte. Votre équipe peut se concentrer sur les clients et les ventes pendant que BMB gère la croissance.",
    economicsNote: "Des tarifs agence sont disponibles via notre programme volume existant. Nous examinons ensemble vos comptes et les conditions applicables — sans nouveau checkout partenaire.",
    economicsSmall: "Aucune projection de revenu ou de performance. Vos résultats commerciaux dépendent de votre offre, de vos clients et de votre exécution.",
    who: "POUR LES ÉQUIPES QUI FONT DÉJÀ GRANDIR LES MARQUES", whoTitle: "Une nouvelle capacité pour votre expertise.",
    whoItems: ["Agences social media", "Agences de marketing digital", "Agences growth", "Freelances multi-clients", "Équipes marketing local", "Consultants & revendeurs"],
    faqTitle: "Un partenariat clair commence par des réponses claires.",
    faq: [
      ["Puis-je intégrer BMB à l’offre de mon agence ?", "Oui. Vous pouvez inclure Instagram Growth dans votre offre commerciale, tandis que BMB prend en charge la croissance opérationnelle. Nous clarifions les responsabilités et la mise en place lors de l’appel partenaire."],
      ["Qui garde la relation client ?", "Votre agence conserve la relation commerciale, sa marque et la stratégie globale. Les clients restent propriétaires de leurs comptes Instagram ; BMB soutient l’exécution du service."],
      ["Dois-je acheter ou gérer des téléphones ?", "Non. BMB gère l’infrastructure de vrais téléphones, l’exécution du ciblage, le monitoring et l’optimisation. Votre équipe n’a pas à construire une phone farm ni à maintenir les systèmes opérationnels."],
      ["Puis-je gérer plusieurs comptes clients ?", "Oui. BMB prend déjà en charge les comptes liés, avec une vue agence, les formules et les statuts opérationnels par compte. Il s’agit de l’expérience BMB existante, pas d’un nouveau portail partenaire."],
      ["Comment fonctionnent les tarifs agence ?", "Le programme volume existant s’applique selon les règles commerciales actuelles et le nombre de comptes éligibles. Nous examinons les conditions lors de l’appel. Cette page ne crée aucun nouveau palier ni tarif."],
      ["BMB parle-t-il directement à mes clients ?", "Votre agence reste l’interlocuteur commercial. Nous convenons avec vous de l’onboarding, du support et des communications opérationnelles nécessaires ; cela ne garantit pas qu’aucun contact direct ne sera jamais requis."],
      ["La marque blanche complète est-elle disponible ?", "Pas dans cette V1. Le modèle de service revendeur n’inclut ni domaine personnalisé, ni dashboard entièrement brandé, ni API partenaire, ni provisioning partenaire automatisé."],
      ["Chaque client peut-il choisir une formule différente ?", "Les comptes peuvent disposer de leur propre formule parmi les packages BMB existants. Choisissez le service adapté à chaque client ; les conditions et le checkout existants restent inchangés."],
      ["Où consulter les performances ?", "Utilisez le dashboard BMB et les vues par compte pour le suivi disponible. La vue agence permet d’identifier les formules et les statuts de connexion et de campagne. Aucun nouveau reporting en marque blanche n’est promis."],
      ["Comment devenir partenaire ?", "Réservez un appel partenaire. Présentez votre agence, vos clients et le service envisagé. Nous examinons ensemble l’adéquation, le programme volume existant et les prochaines étapes."],
    ],
    finalLabel: "CONSTRUISONS VOTRE PROCHAIN SERVICE", finalTitle: "Vous apportez les clients. Nous apportons l’opérationnel.", finalLead: "Voyons comment Instagram Growth s’intègre à votre agence — avant de faire évoluer votre offre.", home: "Accueil", faqLabel: "FAQ PARTENAIRES", illustration: "Illustration conceptuelle d’une agence reliée à une opération supervisée sur de vrais téléphones",
  },
};

export default function PartnersPage() {
  const [lang, setLang] = useMarketingLanguage();
  const t = copy[lang];
  const call = <a className={s.primary} href={CALL} target="_blank" rel="noopener noreferrer">{t.call}<span aria-hidden="true">↗</span></a>;
  return <div className={s.page}>
    <a href="#main" className={s.skip}>{lang === "fr" ? "Aller au contenu" : "Skip to content"}</a>
    <header className={s.nav}>
      <Link href="/" className={s.brand} aria-label={`Boost My Businesses — ${t.home}`}><Image src="/instagram-growth/assets/icon-square-256.png" width={40} height={40} alt=""/><span>Boost<span>My</span>Businesses</span></Link>
      <nav aria-label={lang === "fr" ? "Navigation principale" : "Main navigation"}><Link href="/instagram-growth">Instagram Growth</Link><a href="#model">{t.model}</a><a href="#faq">FAQ</a></nav>
      <div className={s.languages} aria-label={lang === "fr" ? "Langue" : "Language"}>{(["fr", "en"] as const).map(l => <button key={l} onClick={() => setLang(l)} aria-pressed={l === lang}>{l.toUpperCase()}</button>)}</div>
      <a href={CALL} className={s.navCall} target="_blank" rel="noopener noreferrer">{t.call} ↗</a>
    </header>
    <main id="main">
      <section className={s.hero} aria-labelledby="partner-title">
        <Image className={s.heroImage} src="/partners/assets/agency-operations-v1.jpg" alt={t.illustration} fill loading="eager" sizes="(max-width: 700px) 1px, (max-width: 1600px) 100vw, 1600px"/>
        <Image className={s.heroMobileImage} src="/partners/assets/agency-operations-mobile-v1.jpg" alt="" fill loading="eager" sizes="(max-width: 700px) 100vw, 1px"/>
        <div className={s.heroCopy}><p className={s.eyebrow}>BMB PARTNERS / {t.partner}</p><h1 id="partner-title">{t.title}<em>{t.accent}</em></h1><p className={s.lead}>{t.intro}</p><div className={s.actions}>{call}<Link className={s.secondary} href="/instagram-growth">{t.product} →</Link></div></div>
        <div className={s.sceneLabels}><div><span>01 / {t.clients}</span><strong>{t.agency}</strong><p>{t.agencyNote}</p></div><div><span>02 / {t.accounts}</span><strong>{t.engine}</strong><p>{t.engineNote}</p></div></div>
      </section>
      <section id="model" className={s.model} aria-labelledby="model-title">
        <div className={s.sectionIntro}><p className={s.eyebrow}>{t.model}</p><h2 id="model-title">{t.modelTitle}</h2><p>{t.modelLead}</p></div>
        <div className={s.poles}>
          <Image src="/partners/assets/agency-operations-v1.jpg" alt="" fill sizes="(max-width: 700px) 100vw, 1200px" className={s.polesImage}/>
          <div className={s.pole}><p className={s.eyebrow}>{t.keep}</p><h3>{t.agency}</h3><ul>{t.keepItems.map(i => <li key={i}>{i}</li>)}</ul></div>
          <span className={s.connector} aria-hidden="true">↔</span>
          <div className={s.pole}><p className={s.eyebrow}>{t.handle}</p><h3>Boost My Businesses</h3><ul>{t.handleItems.map(i => <li key={i}>{i}</li>)}</ul></div>
          <p className={s.caption}>{t.modelFoot}</p>
        </div>
      </section>
      <section className={s.multi} aria-labelledby="multi-title">
        <div className={s.multiHeading}><p className={s.eyebrow}>{t.multiLabel}</p><h2 id="multi-title">{t.multiTitle}</h2><p>{t.multiLead}</p></div>
        <div className={s.accountScene}>
          <div className={s.agencyHub}><Image src="/instagram-growth/assets/icon-square-256.png" alt="" width={32} height={32}/><span>{t.agency}<small>BMB · {lang === "fr" ? "Vue d’ensemble" : "Account overview"}</small></span></div>
          <div className={s.accountRail}>{t.examples.map((example, i) => <article className={s.phone} key={example}><div className={s.phoneNotch}/><span className={s.accountIndex}>0{i+1} / {t.account}</span><h3>{example}</h3><div className={`${s.screen} ${s[`screen${i}`]}`} aria-hidden="true"><span>◎</span><div/><div/><div/></div><ul>{t.accountInfo.map(label => <li key={label}><span className={s.statusDot}/>{label}<span aria-hidden="true">↗</span></li>)}</ul></article>)}</div>
          <p className={s.caption}>{t.multiFoot}</p>
        </div>
      </section>
      <section className={s.economics} aria-labelledby="economics-title"><p className={s.eyebrow}>{t.economicsLabel}</p><h2 id="economics-title">{t.economicsTitle}</h2><p className={s.lead}>{t.economicsLead}</p><div className={s.volume}><span aria-hidden="true">↗</span><p>{t.economicsNote}</p></div><div className={s.actions}>{call}<Link className={s.secondary} href="/instagram-growth#pricing">{t.plans} →</Link></div><p className={s.disclaimer}>{t.economicsSmall}</p></section>
      <section className={s.who}><p className={s.eyebrow}>{t.who}</p><h2>{t.whoTitle}</h2><ul>{t.whoItems.map(i => <li key={i}>{i}</li>)}</ul></section>
      <section id="faq" className={s.faq}><p className={s.eyebrow}>{t.faqLabel}</p><h2>{t.faqTitle}</h2><div>{t.faq.map(([q,a],i) => <details key={i}><summary><span className={s.faqNumber}>{String(i+1).padStart(2,"0")}</span>{q}<span className={s.plus} aria-hidden="true">+</span></summary><p>{a}</p></details>)}</div></section>
      <section className={s.final}><p className={s.eyebrow}>{t.finalLabel}</p><h2>{t.finalTitle}</h2><p>{t.finalLead}</p>{call}</section>
    </main>
    <footer className={s.footer}><Link href="/">Boost My Businesses · {t.home}</Link><Link href="/instagram-growth">Instagram Growth</Link><Link href="/instagram-growth#pricing">{t.plans}</Link><Link href="/ai-automation">AI Automation</Link><Link href="/privacy-policy">{lang === "fr" ? "Confidentialité" : "Privacy"}</Link><span>© 2026 Boost My Businesses Ltd.</span></footer>
  </div>;
}
