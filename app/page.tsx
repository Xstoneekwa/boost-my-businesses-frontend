"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";

// ─── Types ───────────────────────────────────────────────────────────────────
type Lang = "fr" | "en";

// Preserve existing localStorage key so returning users keep their language pref
const LANG_KEY = "boost_ai_landing_lang_v1";

// ─── i18n ─────────────────────────────────────────────────────────────────────
const copy = {
  fr: {
    nav: { bookDemo: "Voir une démo", cta: "Démarrer →", links: [{ l: "Services", h: "#services" }, { l: "Agents", h: "#agents" }, { l: "Clients", h: "#cases" }, { l: "Tarifs", h: "#pricing" }] },
    hero: {
      tag: "Automatisation IA & Croissance Instagram",
      h1: "Automatisez vos opérations. Développez votre audience. Scalez votre business.",
      sub: "Deux leviers. Une seule plateforme.",
      lead: "Boost My Businesses construit des systèmes IA qui gèrent vos messages, qualifient vos leads et automatisent vos tâches répétitives — et développe votre Instagram avec 200 à 800 vrais abonnés ciblés chaque mois.",
      cta1: "Réserver une démo", cta2: "Explorer les services",
      benefits: ["Agents IA actifs 24h/24", "200–800 vrais abonnés / mois", "Aucune compétence technique requise"],
      igBadge: "Instagram Growth · Actif",
      igCountLabel: "abonnés gagnés", igCountSub: "sur les comptes actifs ce mois-ci",
      igCardTitle: "Agent Croissance Instagram",
      igCardDesc: "Abonnés réels, géolocalisés et qualifiés, attirés 24h/24 depuis de vrais téléphones. Zéro risque pour votre compte.",
      igCardCta: "Découvrir le service",
      s1num: "7×", s1title: "Vitesse de réponse aux leads", s1desc: "Plus de chances de convertir en répondant dans la première heure",
      s2num: "24/7", s2title: "Toujours actif", s2desc: "Des agents IA qui ne dorment jamais et ne manquent aucun message",
    },
    ig: {
      kicker: "Instagram Growth",
      h2a: "Développez votre Instagram.", h2b: "Automatiquement.",
      lead: "Des abonnés réels, géolocalisés et qualifiés, attirés 24h/24 par des agents IA depuis de vrais téléphones. Zéro bot, zéro faux compte — une croissance authentique et mesurable chaque mois.",
      f1t: "Abonnés réels et ciblés", f1d: "Des comptes qui correspondent à votre niche, votre ville ou votre client cible — pas des chiffres gonflés au hasard.",
      f2t: "Activité naturelle, zéro risque", f2d: "Chaque action est générée de manière organique. Instagram voit un comportement authentique. Votre compte reste protégé.",
      f3t: "Actif 24h/24, entièrement géré", f3d: "Vous ne touchez à rien. Le système tourne, se surveille et s'optimise pendant que vous gérez votre activité.",
      stats: [{ n: "200–800", l: "vrais abonnés / mois" }, { n: "0%", l: "bots ou faux comptes" }, { n: "24/7", l: "agents IA actifs" }],
      cta1: "Voir le service complet", cta2: "Réserver une démo",
      profileName: "MonBusiness", profileHandle: "@monbusiness_fr",
      counterSub: "abonnés · +840 ce mois-ci", actTitle: "Activité en direct · Géociblée",
      followed: "a suivi votre compte", live: "Live",
      trust: ["Vrais téléphones", "Géociblés", "0% bots", "Zéro risque compte"],
      todayLabel1: "nouveaux abonnés", todayLabel2: "aujourd'hui · en cours",
    },
    svc: {
      kicker: "Ce que nous construisons", h2: "Des systèmes. Une plateforme.",
      lead: "Des outils d'automatisation IA conçus pour les entreprises qui ne peuvent pas se permettre de manquer des messages, ralentir ou embaucher pour tenir le rythme.",
      cards: [
        { t: "Assistants téléphoniques IA", d: "Répondent aux appels, collectent les informations clients et orientent les demandes. Conçus pour les restaurants, équipes de service et entreprises sur rendez-vous.", o: "↓ Appels manqués" },
        { t: "Automatisation WhatsApp & Leads", d: "Répondent aux leads entrants, qualifient l'intention et déclenchent les relances. Pour les équipes qui reçoivent des leads via WhatsApp, formulaires ou réseaux sociaux.", o: "↑ Capture de leads" },
        { t: "Automatisation du support client", d: "Gère les questions fréquentes et prépare des transmissions propres pour les cas complexes. Réduit la charge support et améliore la communication client.", o: "↓ Charge support" },
        { t: "Automatisation des process métier", d: "Connecte vos outils, tableaux de bord, notifications et tâches récurrentes. Améliore la vitesse opérationnelle, le suivi et la fiabilité.", o: "↑ Vitesse opérationnelle" },
      ],
    },
    agents: {
      kicker: "Systèmes IA prêts pour le terrain",
      h2: "Des agents IA, chacun résout un problème précis.",
      lead: "Choisissez-en un ou combinez-les. Chacun est un système IA configuré et testé, pas un modèle.",
      cards: [
        { n: "Agent 01", t: "Assistant Personnel IA", d: "Centralise les demandes et automatise les tâches récurrentes du quotidien. Gagnez du temps sur les opérations à faible valeur.", o: "↑ Temps économisé", href: "https://www.boostmybusinesses.com/agent/general", l: "Voir la page →" },
        { n: "Agent 02", t: "Système IA de traitement des leads WhatsApp", d: "Répond aux leads WhatsApp, détecte l'intention et déclenche le bon suivi. Captez plus de leads sans ralentir l'équipe.", o: "↑ Leads capturés", href: "https://www.boostmybusinesses.com/agent/whatsapp-lead-system", l: "Voir la page →" },
        { n: "Agent 03", t: "Moteur de création UGC", d: "Transforme une idée ou une image en un brief vidéo UGC structuré, prêt à produire. Créez du contenu orienté conversion plus rapidement.", o: "↑ Rapidité de création", href: "https://www.boostmybusinesses.com/agent/ugc-ads-engine", l: "Voir la page →" },
        { n: "Agent 04", t: "Agent Support IA", d: "Gère les demandes fréquentes et prépare des escalades humaines utiles. Réduisez la charge support et accélérez les réponses.", o: "↓ Charge support", href: "https://www.boostmybusinesses.com/agent/support", l: "Voir la page →" },
        { n: "Agent 05", t: "Assistant Appels Restaurant IA", d: "Répond aux appels, capture les réservations et suit les escalades. Récupérez les appels manqués et améliorez l'accueil client.", o: "↓ Appels manqués", href: "https://www.boostmybusinesses.com/agent/restaurant-call-assistant", l: "Voir la page →" },
        { n: "Agent 06", t: "Croissance Instagram", d: "Agents IA qui identifient et attirent des abonnés réels, géolocalisés et qualifiés 24h/24. 200 à 800 vrais abonnés par mois, sans risque pour votre compte.", o: "200–800 abonnés/mois", href: "/instagram-growth", l: "Voir la landing page →" },
      ],
    },
    uc: {
      kicker: "Cas d'usage",
      h2: "Pour les équipes qui ont besoin de ",
      h2grad: "réponses plus rapides et moins de répétition.",
      tabs: ["Restaurants", "Agences & consultants", "Santé & services", "E-commerce", "Instagram Growth", "Créateurs & ads"],
      panels: [
        { id: "resto", h: "Restaurants", p: "Les appels manqués pendant les heures de pointe vous coûtent des réservations chaque jour. Un assistant téléphonique IA répond à chaque appel, capture les détails de réservation et oriente les demandes — pour que votre équipe se concentre sur le service.", bl: ["Plus jamais d'appel de réservation manqué", "Orientation automatique vers la bonne personne", "Fonctionne pendant les heures de pointe sans personnel supplémentaire"], sn: "↓ 80%", sl: "appels manqués · mois 1", it: "Chaque appel décroché. Chaque réservation capturée.", img: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&q=80" },
        { id: "agency", h: "Agences & consultants", p: "Qualifier les leads manuellement prend des heures. Un système IA gère la première réponse, détecte l'intention et déclenche le bon suivi — pour que votre équipe ne parle qu'aux personnes prêtes à avancer.", bl: ["Qualification et scoring automatique des leads", "Suivi cohérent sur tous les canaux", "Plus de temps pour les missions à haute valeur"], sn: "3×", sl: "plus de leads qualifiés", it: "Votre équipe ne parle qu'aux personnes prêtes à avancer.", img: "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=900&q=80" },
        { id: "health", h: "Santé & services", p: "La communication avec patients et clients est critique et chronophage. L'IA gère les demandes de rendez-vous, les réponses aux FAQ et le tri de premier niveau pour libérer votre équipe pour le vrai soin.", bl: ["Gestion des demandes de rendez-vous 24h/24", "FAQ automatisée pour les questions courantes", "Escalade propre vers un humain si nécessaire"], sn: "24/7", sl: "communication patients gérée", it: "Les patients obtiennent des réponses sans attendre.", img: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=900&q=80" },
        { id: "ecom", h: "E-commerce", p: "Le volume de support explose pendant les ventes. Un agent support IA gère le statut des commandes, les retours et les FAQ pour que votre équipe ne soit pas submergée au pire moment.", bl: ["Réponses instantanées sur commandes et retours", "S'adapte automatiquement aux périodes de pointe", "Réduit le volume de tickets sans embauche"], sn: "↓ 60%", sl: "tickets traités automatiquement", it: "Passez les pics de ventes sans embaucher.", img: "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=900&q=80" },
        { id: "training", h: "Instagram Growth", p: "Faire croître sa communauté Instagram de façon organique est lent et imprévisible. Nos agents IA travaillent 24h/24 depuis de vrais téléphones pour attirer des abonnés réels, géociblés et dans votre niche — sans aucun risque pour votre compte.", bl: ["200 à 800 vrais abonnés ciblés chaque mois", "Actions réalisées depuis de vrais appareils mobiles. Instagram voit un comportement naturel", "Zéro bot, zéro faux compte, zéro risque pour votre compte"], sn: "+800", sl: "vrais abonnés / mois", it: "Vrais abonnés. Vrai engagement. Zéro risque.", img: "https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=900&q=80" },
        { id: "creators", h: "Créateurs & ads", p: "Créer du contenu UGC à l'échelle est lent et incohérent. L'UGC Ads Engine transforme un brief ou une image en vidéo structurée prête à produire en quelques minutes.", bl: ["Brief UGC structuré à partir de n'importe quelle idée", "Format de sortie cohérent, à chaque fois", "10× plus rapide qu'un brief manuel"], sn: "10×", sl: "création de brief plus rapide", it: "D'une idée à un brief prêt à produire en quelques minutes.", img: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=900&q=80" },
      ],
    },
    testi: {
      kicker: "Systèmes testés en production",
      h2: "Ils nous font confiance pour ",
      h2grad: "gérer leurs opérations.",
      lead: "Des restaurants aux cabinets de conseil et associations, nos systèmes IA sont déjà utilisés dans des environnements exigeants.",
      cards: [
        { q: "Nous avons utilisé le système pour mieux gérer les demandes entrantes pendant les périodes chargées. Il aide à réduire les opportunités manquées et à maintenir le bon fonctionnement des opérations.", name: "Rachelle", sector: "Restaurant · In de Patattezak", avatar: "/assets/rachelle.jpg" },
        { q: "Nous avons déployé plusieurs systèmes d'automatisation de Boost My Businesses. L'architecture est fiable, flexible et vraiment conçue pour une utilisation en conditions réelles.", name: "Patrick K.", sector: "Conseil en ingénierie · DMT", avatar: "/assets/patrick.jpg" },
        { q: "Nous avons adapté une version personnalisée du système à nos besoins. Il nous a aidés à gérer les demandes plus efficacement sans alourdir la charge de travail de notre équipe.", name: "Laurianne", sector: "ONG · Save Animals", avatar: "/assets/laurianne.jpg" },
      ],
    },
    recv: {
      kicker: "Transparence",
      h2: "Ce que chaque client ",
      h2grad: "reçoit concrètement.",
      lead: "Chaque service est livré comme un système d'automatisation IA configuré, pas seulement un conseil ou un fichier.",
      items: ["Configuration du système IA et onboarding", "Accès au tableau de bord d'automatisation", "Support mensuel selon la formule", "Optimisation et maintenance continues", "Intégration dans vos process métier", "Automatisation des communications clients"],
    },
    price: {
      kicker: "Tarifs",
      h2: "Une façon simple de ",
      h2grad: "lancer vos automatisations.",
      lead: "Toutes les formules incluent l'onboarding, le paramétrage et l'accès aux services d'automatisation IA sélectionnés.",
      plans: [
        { name: "Starter", desc: "Une automatisation ciblée pour un besoin métier précis.", priceFrom: "À partir de", price: "147", curr: "€", feats: ["1 système IA", "1 cas d'usage principal", "Configuration de base"], featured: false, cta: "Démarrer" },
        { name: "Growth", desc: "Plus de logique, plus d'intégrations, plus d'impact métier.", priceFrom: "À partir de", price: "799", curr: "€", feats: ["1 à 2 systèmes IA", "Intégrations outils métier", "Optimisé pour conversion et gain de temps"], featured: true, badge: "Le plus populaire", cta: "Démarrer" },
        { name: "Custom", desc: "Architecture sur mesure pour des process plus avancés.", priceCustom: "Sur devis", feats: ["Configuration multi-flux", "Logique d'automatisation avancée", "Support et options d'évolution"], featured: false, cta: "Nous contacter" },
      ],
    },
    cta: { h2: "Réservez une démo en ", h2dim: "30 secondes.", p: "Voyez comment l'automatisation IA peut vous faire gagner du temps et récupérer des opportunités manquées. Choisissez le système adapté à votre besoin.", btn1: "Réserver une démo", btn2: "Explorer les agents" },
    footer: {
      tagline: "Agents IA conçus pour vos vrais process métier. Aucune compétence technique requise.",
      col1: "Agents", col2: "Société", col3: "Légal",
      agents: [{ l: "UGC Ads Engine", h: "https://www.boostmybusinesses.com/agent/ugc-ads-engine" }, { l: "AI Assistant", h: "https://www.boostmybusinesses.com/agent/general" }, { l: "WhatsApp Leads", h: "https://www.boostmybusinesses.com/agent/whatsapp-lead-system" }, { l: "Restaurant Call", h: "https://www.boostmybusinesses.com/agent/restaurant-call-assistant" }, { l: "Support Agent", h: "https://www.boostmybusinesses.com/agent/support" }, { l: "Instagram Growth", h: "/instagram-growth" }],
      company: [{ l: "Tarifs", h: "#pricing" }, { l: "À propos", h: "https://www.boostmybusinesses.com/about" }, { l: "Contact", h: "https://www.boostmybusinesses.com/contact" }],
      legal: [{ l: "Politique de confidentialité", h: "https://www.boostmybusinesses.com/privacy-policy" }, { l: "Conditions d'utilisation", h: "https://www.boostmybusinesses.com/terms-and-conditions" }, { l: "Remboursement", h: "https://www.boostmybusinesses.com/refund-policy" }],
      copy: "© 2026 Boost My Businesses Ltd. Tous droits réservés.",
      registration: "Boost My Businesses Ltd — Immatriculée en Angleterre et au Pays de Galles, société n° 17313018. Siège social : 167-169 Great Portland Street, 5th Floor, London, W1W 5PF, Royaume-Uni.",
    },
    calendly: { title: "Réserve une démo en 30 secondes", sub: "Découvre comment l'automatisation IA peut faire gagner du temps et récupérer des opportunités perdues." },
  },
  en: {
    nav: { bookDemo: "Book a demo", cta: "Get started →", links: [{ l: "Services", h: "#services" }, { l: "Agents", h: "#agents" }, { l: "Clients", h: "#cases" }, { l: "Pricing", h: "#pricing" }] },
    hero: {
      tag: "AI Automation & Instagram Growth",
      h1: "Automate your operations. Grow your audience. Scale your business.",
      sub: "Two levers. One platform.",
      lead: "Boost My Businesses builds AI systems that handle your messages, qualify leads, and automate repetitive tasks — and grows your Instagram with 200 to 800 real, targeted followers every month.",
      cta1: "Book a demo", cta2: "Explore services",
      benefits: ["AI agents active 24/7", "200–800 real followers / month", "No technical skills required"],
      igBadge: "Instagram Growth · Live",
      igCountLabel: "followers gained", igCountSub: "across active accounts this month",
      igCardTitle: "Instagram Growth Agent",
      igCardDesc: "Real, geo-targeted, qualified followers attracted 24/7 — from real phones, zero account risk.",
      igCardCta: "Discover the service",
      s1num: "7×", s1title: "Lead response speed", s1desc: "More likely to convert when replied within the first hour",
      s2num: "24/7", s2title: "Always on", s2desc: "AI agents that never sleep, never miss a message",
    },
    ig: {
      kicker: "Instagram Growth",
      h2a: "Grow your Instagram.", h2b: "Automatically.",
      lead: "Real, geo-targeted, qualified followers attracted 24/7 by AI agents operating from real phones. No bots, no fake accounts — just measurable, authentic growth every single month.",
      f1t: "Real, targeted followers", f1d: "Accounts that match your niche, city or target customer — not random inflated numbers.",
      f2t: "Natural activity, zero account risk", f2d: "Every action is generated organically. Instagram sees authentic behaviour. Your account stays protected.",
      f3t: "Active 24/7, fully managed", f3d: "You don't touch anything. The system runs, monitors and optimises itself while you focus on your business.",
      stats: [{ n: "200–800", l: "real followers / month" }, { n: "0%", l: "bots or fake accounts" }, { n: "24/7", l: "active AI agents" }],
      cta1: "See the full service", cta2: "Book a demo",
      profileName: "MonBusiness", profileHandle: "@monbusiness_fr",
      counterSub: "followers · +840 this month", actTitle: "Live activity · Geo-targeted",
      followed: "followed your account", live: "Live",
      trust: ["Real phones", "Geo-targeted", "0% bots", "Zero account risk"],
      todayLabel1: "new followers today", todayLabel2: "today · still counting",
    },
    svc: {
      kicker: "What we build", h2: "Four systems. One platform.",
      lead: "AI-powered automation tools built for businesses that can't afford to miss messages, slow down, or hire just to keep up.",
      cards: [
        { t: "AI Call Assistants", d: "Answer phone calls, collect customer details, and route requests. Built for restaurants, service teams, and appointment-based businesses. Improves response speed and reduces missed calls.", o: "↓ Missed calls" },
        { t: "WhatsApp & Lead Automation", d: "Respond to incoming leads, qualify intent, and trigger follow-up flows. Helps teams that receive leads through WhatsApp, forms, or social channels.", o: "↑ Lead capture" },
        { t: "Customer Support Automation", d: "Handles frequent questions and prepares clean handoffs for complex issues. Reduces support load and improves customer communication.", o: "↓ Support load" },
        { t: "Business Workflow Automation", d: "Connects tools, dashboards, notifications, and recurring operational tasks. Improves operational speed, tracking, and reliability.", o: "↑ Operational speed" },
      ],
    },
    agents: {
      kicker: "AI systems ready for real operations",
      h2: "Six agents, each solving a specific problem.",
      lead: "Pick one or combine them. Each is a configured, tested AI system — not a template.",
      cards: [
        { n: "Agent 01", t: "AI Personal Assistant", d: "Centralizes requests and automates recurring daily tasks. Save time on low-value operations.", o: "↑ Time saved", href: "https://www.boostmybusinesses.com/agent/general", l: "Open page →" },
        { n: "Agent 02", t: "AI WhatsApp Lead Handling System", d: "Replies to WhatsApp leads, detects intent, and triggers the right follow-up. Capture more leads without slowing the team.", o: "↑ Leads captured", href: "https://www.boostmybusinesses.com/agent/whatsapp-lead-system", l: "Open page →" },
        { n: "Agent 03", t: "UGC Ads Engine", d: "Turns an idea or image into a structured UGC video ready for production. Create conversion-focused content faster.", o: "↑ Content speed", href: "https://www.boostmybusinesses.com/agent/ugc-ads-engine", l: "Open page →" },
        { n: "Agent 04", t: "AI Support Agent", d: "Handles frequent requests and prepares useful human escalations. Reduce support load and speed up replies.", o: "↓ Support load", href: "https://www.boostmybusinesses.com/agent/support", l: "Open page →" },
        { n: "Agent 05", t: "AI Restaurant Call Assistant", d: "Answers calls, captures bookings, and tracks escalations. Recover missed calls and improve customer handling.", o: "↓ Missed calls", href: "https://www.boostmybusinesses.com/agent/restaurant-call-assistant", l: "Open page →" },
        { n: "Agent 06", t: "Instagram Growth", d: "AI agents that identify and attract real, geo-targeted, qualified followers 24/7. 200 to 800 real followers per month, with zero account risk.", o: "200–800 followers/mo", href: "/instagram-growth", l: "View landing page →" },
      ],
    },
    uc: {
      kicker: "Use cases",
      h2: "For teams that need ",
      h2grad: "faster replies and less repetition.",
      tabs: ["Restaurants", "Agencies & consultants", "Health & services", "E-commerce", "Instagram Growth", "Creators & ads"],
      panels: [
        { id: "resto", h: "Restaurants", p: "Missed calls during rush hours cost you bookings every single day. An AI call assistant answers every call, captures reservation details, and routes requests — so your team can focus on the floor.", bl: ["Never miss a booking call again", "Automatic routing to the right person", "Works during rush hours without extra staff"], sn: "↓ 80%", sl: "missed calls · month 1", it: "Every call answered. Every booking captured.", img: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&q=80" },
        { id: "agency", h: "Agencies & consultants", p: "Qualifying leads manually takes hours. An AI system handles the first response, detects intent, and triggers the right follow-up — so your team only talks to people who are ready.", bl: ["Automatic lead qualification and scoring", "Consistent follow-up across all channels", "More time for high-value client work"], sn: "3×", sl: "more qualified leads", it: "Your team talks only to people who are ready.", img: "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=900&q=80" },
        { id: "health", h: "Health & services", p: "Patient and client communication is critical and time-consuming. AI handles appointment requests, FAQ responses, and first-level triage — freeing your team for real care.", bl: ["24/7 appointment request handling", "Automated FAQ for common patient questions", "Clean escalation to human when needed"], sn: "24/7", sl: "patient comms handled", it: "Patients get answers without waiting.", img: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=900&q=80" },
        { id: "ecom", h: "E-commerce", p: "Support volume spikes during sales. An AI support agent handles order status, returns, and FAQ — so your team isn't buried when it matters most.", bl: ["Instant responses on order status and returns", "Scales automatically during peak periods", "Reduces ticket volume without hiring"], sn: "↓ 60%", sl: "tickets handled automatically", it: "Scale during peaks without hiring.", img: "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=900&q=80" },
        { id: "training", h: "Instagram Growth", p: "Growing an Instagram following organically is slow and unpredictable. Our AI agents work 24/7 from real phones to attract real, geo-targeted followers who match your niche — with zero account risk.", bl: ["200 to 800 real, targeted followers every month", "Actions performed from real mobile devices — Instagram sees natural behavior", "Zero bots, zero fake accounts, zero account risk"], sn: "+800", sl: "real followers / month", it: "Real followers. Real engagement. Zero risk.", img: "https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=900&q=80" },
        { id: "creators", h: "Creators & ads", p: "Creating UGC content at scale is slow and inconsistent. The UGC Ads Engine turns a brief or image into a structured video ready for production in minutes.", bl: ["Structured UGC brief from any idea or image", "Consistent output format, every time", "10× faster than manual briefing"], sn: "10×", sl: "faster brief creation", it: "From idea to production-ready brief in minutes.", img: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=900&q=80" },
      ],
    },
    testi: {
      kicker: "Production-tested systems",
      h2: "They trust us to handle ",
      h2grad: "their operations.",
      lead: "From restaurants to consulting and non-profits, our AI systems are already used in demanding environments.",
      cards: [
        { q: "We used the system to better handle incoming requests during busy periods. It helps reduce missed opportunities and keeps the whole operation smooth.", name: "Rachelle", sector: "Restaurant · In de Patattezak", avatar: "/assets/rachelle.jpg" },
        { q: "We've deployed several automation systems from Boost My Businesses. The architecture is reliable, flexible, and genuinely built for real-world usage.", name: "Patrick K.", sector: "Engineering consulting · DMT", avatar: "/assets/patrick.jpg" },
        { q: "We adapted a custom version of the system to our needs. It helped us manage requests more efficiently without increasing workload on our team.", name: "Laurianne", sector: "NGO · Save Animals", avatar: "/assets/laurianne.jpg" },
      ],
    },
    recv: {
      kicker: "Transparency",
      h2: "What every client ",
      h2grad: "actually receives.",
      lead: "Each service is delivered as a configured AI automation system, not just advice or a one-time file.",
      items: ["AI system setup and onboarding", "Access to automation dashboard", "Monthly support depending on plan", "Ongoing optimization and maintenance", "Business workflow integration", "Customer communication automation"],
    },
    price: {
      kicker: "Pricing",
      h2: "A simple way to get ",
      h2grad: "your automations live.",
      lead: "All plans include onboarding, setup guidance, and access to the selected AI automation services.",
      plans: [
        { name: "Starter", desc: "One focused automation for one clear business need.", priceFrom: "From", price: "147", curr: "€", feats: ["1 AI system", "1 main use case", "Basic setup"], featured: false, cta: "Get started" },
        { name: "Growth", desc: "More logic, more integrations, more business impact.", priceFrom: "From", price: "799", curr: "€", feats: ["1 to 2 AI systems", "Business tool integrations", "Optimized for conversion / time savings"], featured: true, badge: "Most popular", cta: "Get started" },
        { name: "Custom", desc: "Tailored architecture for more advanced workflows.", priceCustom: "Custom quote", feats: ["Multi-flow setup", "Business automation logic", "Support and evolution options"], featured: false, cta: "Contact us" },
      ],
    },
    cta: { h2: "Book a demo in ", h2dim: "30 seconds.", p: "See how AI automation can save time and recover missed opportunities. Choose the system that matches your need.", btn1: "Book a demo", btn2: "Explore agents" },
    footer: {
      tagline: "AI agents built for real business workflows. No technical skills required.",
      col1: "Agents", col2: "Company", col3: "Legal",
      agents: [{ l: "UGC Ads Engine", h: "https://www.boostmybusinesses.com/agent/ugc-ads-engine" }, { l: "AI Assistant", h: "https://www.boostmybusinesses.com/agent/general" }, { l: "WhatsApp Leads", h: "https://www.boostmybusinesses.com/agent/whatsapp-lead-system" }, { l: "Restaurant Call", h: "https://www.boostmybusinesses.com/agent/restaurant-call-assistant" }, { l: "Support Agent", h: "https://www.boostmybusinesses.com/agent/support" }, { l: "Instagram Growth", h: "/instagram-growth" }],
      company: [{ l: "Pricing", h: "#pricing" }, { l: "About", h: "https://www.boostmybusinesses.com/about" }, { l: "Contact", h: "https://www.boostmybusinesses.com/contact" }],
      legal: [{ l: "Privacy policy", h: "https://www.boostmybusinesses.com/privacy-policy" }, { l: "Terms of service", h: "https://www.boostmybusinesses.com/terms-and-conditions" }, { l: "Refund policy", h: "https://www.boostmybusinesses.com/refund-policy" }],
      copy: "© 2026 Boost My Businesses Ltd. All rights reserved.",
      registration: "Boost My Businesses Ltd — Registered in England & Wales, Company No. 17313018. Registered office: 167-169 Great Portland Street, 5th Floor, London, W1W 5PF, United Kingdom.",
    },
    calendly: { title: "Book a demo in 30 seconds", sub: "See how AI automation can save time and recover missed opportunities." },
  },
};

// ─── Activity feed data ───────────────────────────────────────────────────────
const ACT_POOL = [
  { h: "@sarah_mode_paris", geo: "Paris 75" }, { h: "@chef_marseille13", geo: "Marseille" },
  { h: "@vins_bordeaux33", geo: "Bordeaux" }, { h: "@mode_lyon_69", geo: "Lyon" },
  { h: "@resto_nice06", geo: "Nice" }, { h: "@sport_lille59", geo: "Lille" },
  { h: "@coiff_paris15", geo: "Paris 92" }, { h: "@bijoux_nantes", geo: "Nantes" },
  { h: "@photo_stras", geo: "Strasbourg" }, { h: "@fit_toulouse", geo: "Toulouse" },
];

const PARTNER_LOGOS = [
  { src: "/assets/logo-gg.png", alt: "GG" },
  { src: "/assets/logo-lecurlshop.png", alt: "Le Curl Shop" },
  { src: "/assets/logo-osoleil.png", alt: "Ô Soleil Boutique" },
  { src: "/assets/logo-plugdrive.png", alt: "Plug and Drive" },
  { src: "/assets/logo-proriderdesign.png", alt: "Pro Rider Design" },
  { src: "/assets/logo-showgirl.png", alt: "Showgirl Atelier" },
];

// ─── Animated counter hook ────────────────────────────────────────────────────
function useAnimatedCounter(start: number, target: number, active: boolean) {
  const [value, setValue] = useState(start);
  useEffect(() => {
    if (!active) return;
    let current = start;
    const step = Math.ceil((target - start) / 80);
    const timer = setInterval(() => {
      current = Math.min(current + step, target);
      setValue(current);
      if (current >= target) {
        clearInterval(timer);
        setTimeout(() => { setValue(target + 12); setTimeout(() => setValue(target), 400); }, 600);
      }
    }, 38);
    return () => clearInterval(timer);
  }, [active, start, target]);
  return value;
}

// ─── Scroll reveal hook ───────────────────────────────────────────────────────
function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

// ─── Avatar with fallback ─────────────────────────────────────────────────────
function Avatar({ src, name }: { src: string; name: string }) {
  const [err, setErr] = useState(false);
  const initial = name.slice(0, 1).toUpperCase();
  if (err) return (
    <span style={{ width: 46, height: 46, borderRadius: "50%", background: "var(--accent-soft)", border: "2px solid var(--accent-ring)", display: "inline-grid", placeItems: "center", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "1rem", color: "var(--accent)", flexShrink: 0 }}>{initial}</span>
  );
  return (
    <Image src={src} alt={name} width={46} height={46} className="case-avatar" onError={() => setErr(true)} />
  );
}

// ─── Logo with fallback ────────────────────────────────────────────────────────
function PartnerLogo({ src, alt }: { src: string; alt: string }) {
  const [err, setErr] = useState(false);
  if (err) return <span style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-display)", fontWeight: 700 }}>{alt}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} style={{ height: 32, objectFit: "contain", opacity: 0.55, filter: "grayscale(1)", transition: "opacity .2s, filter .2s" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "1"; (e.currentTarget as HTMLImageElement).style.filter = "none"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.55"; (e.currentTarget as HTMLImageElement).style.filter = "grayscale(1)"; }}
      onError={() => setErr(true)}
    />
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [scrolled, setScrolled] = useState(false);
  const [activeSector, setActiveSector] = useState("resto");

  // IG hero counter
  const igCardRef = useRef<HTMLAnchorElement>(null);
  const [igHeroVisible, setIgHeroVisible] = useState(false);
  const igHeroCount = useAnimatedCounter(4120, 4872, igHeroVisible);

  // IG section counter
  const igSecRef = useRef<HTMLDivElement>(null);
  const [igSecVisible, setIgSecVisible] = useState(false);
  const igSecCount = useAnimatedCounter(11840, 12680, igSecVisible);

  // Activity feed
  const actIdxRef = useRef(4);
  const [actItems, setActItems] = useState(ACT_POOL.slice(0, 4));
  const [todayCount, setTodayCount] = useState(24);

  const t = copy[lang];

  // Init lang from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(LANG_KEY) as Lang | null;
    if (saved === "fr" || saved === "en") setLang(saved);
  }, []);

  // Persist lang
  useEffect(() => { localStorage.setItem(LANG_KEY, lang); }, [lang]);

  // Scroll state
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  // Scroll reveal
  useReveal();

  // IG hero counter observer
  useEffect(() => {
    const el = igCardRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { setIgHeroVisible(true); io.disconnect(); }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // IG section counter observer
  useEffect(() => {
    const el = igSecRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { setIgSecVisible(true); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Activity feed rotation
  useEffect(() => {
    const timer = setInterval(() => {
      const item = ACT_POOL[actIdxRef.current % ACT_POOL.length];
      actIdxRef.current++;
      setActItems((prev) => [item, ...prev].slice(0, 4));
      setTodayCount((n) => n + 1);
    }, 4200);
    return () => clearInterval(timer);
  }, []);

  // Hover helpers
  const hov = useCallback((color: string, bg: string, bdr: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { const el = e.currentTarget as HTMLElement; el.style.color = color; el.style.background = bg; el.style.borderColor = bdr; },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { const el = e.currentTarget as HTMLElement; el.style.color = ""; el.style.background = ""; el.style.borderColor = ""; },
  }), []);

  return (
    <>
      <style>{CSS}</style>

      {/* ── NAV ── */}
      <header className="nav" style={{ background: scrolled ? "color-mix(in srgb,var(--page-bg) 92%,transparent)" : "color-mix(in srgb,var(--page-bg) 82%,transparent)" }}>
        <div className="wrap nav-inner">
          <a className="brand" href="#top">
            <Image className="logo-mark" src="/instagram-growth/assets/icon-square-256.png" alt="" width={36} height={36} aria-hidden="true" />
            <span>Boost<span className="brand-my">My</span>Businesses</span>
          </a>
          <nav className="nav-links">
            {t.nav.links.map((lk) => (
              <a key={lk.h} href={lk.h}>{lk.l}</a>
            ))}
          </nav>
          <div className="nav-right">
            <div className="lang-toggle">
              {(["fr", "en"] as Lang[]).map((l) => (
                <button key={l} type="button" className={lang === l ? "on" : ""} onClick={() => setLang(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <a className="nav-cta-soft" href="#pricing">{t.nav.bookDemo}</a>
            <a className="btn btn-primary btn-sm" href="#pricing">{t.nav.cta}</a>
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="hero" id="top">
        <div className="wrap">
          <div className="hero-layout">
            <div>
              <div className="hero-tag"><span className="dot" /><span>{t.hero.tag}</span></div>
              <h1>{t.hero.h1}</h1>
              <p className="hero-sub">{t.hero.sub}</p>
              <p className="lead">{t.hero.lead}</p>
              <div className="hero-cta">
                <a className="btn btn-primary btn-lg" href="https://www.boostmybusinesses.com/contact" target="_blank" rel="noopener noreferrer">{t.hero.cta1}</a>
                <a className="btn btn-soft btn-lg" href="#agents">{t.hero.cta2}</a>
              </div>
              <div className="hero-benefits">
                {t.hero.benefits.map((b) => (
                  <div key={b} className="hero-benefit"><span className="ck">✓</span><span>{b}</span></div>
                ))}
              </div>
            </div>

            <div className="hero-stats">
              {/* IG Growth card */}
              <a className="ig-card-wrap reveal" data-delay="1" ref={igCardRef} href="/instagram-growth" aria-label={t.hero.igCardTitle}>
                <div className="ig-card">
                  <div className="ig-card-top">
                    <div className="ig-badge"><span className="ig-live-dot" /><span>{t.hero.igBadge}</span></div>
                    <div className="ig-count-wrap">
                      <span className="ig-count">{igHeroCount.toLocaleString("fr-FR")}</span>
                      <span className="ig-count-label">{t.hero.igCountLabel}</span>
                    </div>
                    <div className="ig-count-sub">{t.hero.igCountSub}</div>
                    <div className="ig-bars">{[...Array(7)].map((_, i) => <span key={i} className="ig-bar" />)}</div>
                  </div>
                  <div className="ig-card-body">
                    <div className="ig-card-title">{t.hero.igCardTitle}</div>
                    <div className="ig-card-desc">{t.hero.igCardDesc}</div>
                    <div className="ig-card-cta">
                      <span>{t.hero.igCardCta}</span>
                      <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                    </div>
                  </div>
                </div>
              </a>

              {/* Stat 1 */}
              <div className="hstat reveal" data-delay="2">
                <div className="hstat-num">{t.hero.s1num}</div>
                <div className="hstat-body">
                  <div className="hstat-title">{t.hero.s1title}</div>
                  <div className="hstat-desc">{t.hero.s1desc}</div>
                </div>
              </div>

              {/* Stat 2 */}
              <div className="hstat reveal" data-delay="3">
                <div className="hstat-num">{t.hero.s2num}</div>
                <div className="hstat-body">
                  <div className="hstat-title">{t.hero.s2title}</div>
                  <div className="hstat-desc">{t.hero.s2desc}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── LOGO BAR ── */}
      <section className="sec" style={{ paddingTop: 40, paddingBottom: 40, borderBottom: "1px solid var(--line)" }}>
        <div className="wrap" style={{ display: "flex", gap: 40, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
          {PARTNER_LOGOS.map((logo) => <PartnerLogo key={logo.alt} {...logo} />)}
        </div>
      </section>

      {/* ── INSTAGRAM GROWTH SECTION ── */}
      <section className="sec ig-growth-sec" id="instagram">
        <div className="wrap">
          <div className="sec-head reveal" style={{ textAlign: "center" }}>
            <div className="ig-growth-kicker" style={{ display: "inline-flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
              <svg viewBox="0 0 24 24" width={17} height={17} fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <defs><linearGradient id="igk" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#f7931e" /><stop offset="50%" stopColor="#e1306c" /><stop offset="100%" stopColor="#833ab4" /></linearGradient></defs>
                <rect x="2" y="2" width="20" height="20" rx="5" stroke="url(#igk)" /><circle cx="12" cy="12" r="5" stroke="url(#igk)" /><circle cx="17.5" cy="6.5" r="1" fill="#e1306c" stroke="none" />
              </svg>
              <span>{t.ig.kicker}</span>
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.9rem,3.6vw,3rem)", fontWeight: 800, lineHeight: 1.06, letterSpacing: "-.02em" }}>
              {t.ig.h2a}<br /><span className="ig-grad-text">{t.ig.h2b}</span>
            </h2>
            <p style={{ marginTop: 14, fontSize: "1.08rem", color: "var(--ink-dim)", lineHeight: 1.55 }}>{t.ig.lead}</p>
          </div>

          <div className="ig-growth-layout">
            {/* LEFT */}
            <div className="ig-growth-text reveal">
              <div className="ig-growth-feats">
                {[
                  { t: t.ig.f1t, d: t.ig.f1d, icon: <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />, icon2: <circle cx="9" cy="7" r="4" />, extra: <><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></> },
                  { t: t.ig.f2t, d: t.ig.f2d, icon: <><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 18h.01" /></> },
                  { t: t.ig.f3t, d: t.ig.f3d, icon: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></> },
                ].map(({ t: ft, d, icon, icon2, extra }) => (
                  <div key={ft} className="ig-growth-feat">
                    <div className="ig-feat-ic">
                      <svg viewBox="0 0 24 24" width={17} height={17} stroke="#e1306c" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{icon}{icon2}{extra}</svg>
                    </div>
                    <div className="ig-feat-body"><strong>{ft}</strong><p>{d}</p></div>
                  </div>
                ))}
              </div>

              <div className="ig-growth-stats-row">
                {t.ig.stats.map((s) => (
                  <div key={s.n} className="ig-gs"><span className="ig-gs-num">{s.n}</span><span className="ig-gs-label">{s.l}</span></div>
                ))}
              </div>

              <div className="ig-growth-cta">
                <a className="btn btn-primary btn-lg" href="/instagram-growth" target="_blank" rel="noopener noreferrer">{t.ig.cta1}</a>
                <a className="btn btn-soft" href="https://www.boostmybusinesses.com/contact" target="_blank" rel="noopener noreferrer">{t.ig.cta2}</a>
              </div>
            </div>

            {/* RIGHT — dashboard card */}
            <div className="ig-growth-visual reveal" data-delay="2" ref={igSecRef}>
              <div className="ig-visual-card">
                <div className="ig-visual-header">
                  <div className="ig-vprofile">
                    <div className="ig-vavatar">M</div>
                    <div className="ig-vinfo">
                      <strong>{t.ig.profileName}</strong>
                      <span>{t.ig.profileHandle}</span>
                    </div>
                    <div className="ig-vlive"><span className="ig-live-dot" /><span>{t.ig.live}</span></div>
                  </div>
                  <div className="ig-vcounter-row">
                    <div className="ig-vcounter-big">{igSecCount.toLocaleString("fr-FR")}</div>
                    <div className="ig-vcounter-sub">{t.ig.counterSub}</div>
                  </div>
                  <div className="ig-vsparkline">
                    {[...Array(10)].map((_, i) => <span key={i} className="ig-vspark" />)}
                  </div>
                </div>

                <div className="ig-vactivity">
                  <div className="ig-vact-title">{t.ig.actTitle}</div>
                  {actItems.map((item, i) => (
                    <div key={`${item.h}-${i}`} className="ig-vact-item">
                      <span className="ig-vact-dot" />
                      <span className="ig-vact-text"><strong>{item.h}</strong> {t.ig.followed}</span>
                      <span className="ig-vact-geo">{item.geo}</span>
                    </div>
                  ))}
                </div>

                <div className="ig-vtrust">
                  {t.ig.trust.map((item, i) => (
                    <span key={item} className="ig-vtrust-item">
                      <svg viewBox="0 0 24 24" width={12} height={12} stroke="var(--good)" fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                      <span>{item}</span>
                      {i < t.ig.trust.length - 1 && <span className="ig-vtrust-sep" />}
                    </span>
                  ))}
                </div>
              </div>

              <div className="ig-vfloat">
                <div className="ig-vfloat-num">+{todayCount}</div>
                <div className="ig-vfloat-text">
                  <strong>{t.ig.todayLabel1}</strong>
                  <span>{t.ig.todayLabel2}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SERVICES ── */}
      <section className="sec" id="services">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="kicker">{t.svc.kicker}</span>
            <h2>{t.svc.h2}</h2>
            <p>{t.svc.lead}</p>
          </div>
          <div className="services-grid">
            {t.svc.cards.map((c, i) => (
              <div key={c.t} className={`svc-card reveal${i > 0 ? ` data-delay-${Math.min(i, 2)}` : ""}`}>
                <div className="svc-icon">
                  <svg viewBox="0 0 24 24" width={22} height={22} stroke="var(--accent)" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    {i === 0 && <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 3.07 11.5 19.79 19.79 0 0 1 .99 2.87 2 2 0 0 1 2.97 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.66-.66a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 17l.64-.08z" />}
                    {i === 1 && <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />}
                    {i === 2 && <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none" /></>}
                    {i === 3 && <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>}
                  </svg>
                </div>
                <h3>{c.t}</h3>
                <p>{c.d}</p>
                <span className="svc-outcome">{c.o}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AGENTS ── */}
      <section className="sec tint" id="agents">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="kicker">{t.agents.kicker}</span>
            <h2>{t.agents.h2}</h2>
            <p>{t.agents.lead}</p>
          </div>
          <div className="agents-grid">
            {t.agents.cards.map((a) => (
              <div key={a.n} className="agent-card reveal">
                <div className="agent-num">{a.n}</div>
                <h3>{a.t}</h3>
                <p>{a.d}</p>
                <span className="agent-outcome">✓ {a.o}</span>
                <a className="agent-link" href={a.href} target="_blank" rel="noopener noreferrer">
                  {a.l}
                  <svg viewBox="0 0 24 24" width={12} height={12} stroke="currentColor" fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── USE CASES ── */}
      <section className="sec" id="usecases">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="kicker">{t.uc.kicker}</span>
            <h2>{t.uc.h2}<span className="grad">{t.uc.h2grad}</span></h2>
          </div>
          <div className="sector-tabs reveal">
            {t.uc.tabs.map((tab, i) => (
              <button key={tab} type="button" className={`sector-tab${activeSector === t.uc.panels[i].id ? " on" : ""}`}
                onClick={() => setActiveSector(t.uc.panels[i].id)}>
                {tab}
              </button>
            ))}
          </div>
          {t.uc.panels.map((panel) => (
            <div key={panel.id} className={`sector-panel${activeSector === panel.id ? " on" : ""}`}>
              <div className="sector-text">
                <h3>{panel.h}</h3>
                <p>{panel.p}</p>
                <ul className="sector-bullets">
                  {panel.bl.map((b) => <li key={b}>{b}</li>)}
                </ul>
              </div>
              <div className="sector-visual">
                <Image className="sector-visual-img" src={panel.img} alt={panel.h} fill style={{ objectFit: "cover" }} sizes="(max-width:768px) 100vw, 50vw" />
                <div className="sector-visual-overlay" />
                <div className="sector-visual-content">
                  <div className="sector-stat-pill">
                    <span className="sp-num">{panel.sn}</span>
                    <span className="sp-label">{panel.sl}</span>
                  </div>
                  <div className="sector-visual-title">{panel.it}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="sec tint" id="cases">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="kicker">{t.testi.kicker}</span>
            <h2>{t.testi.h2}<span className="grad">{t.testi.h2grad}</span></h2>
            <p>{t.testi.lead}</p>
          </div>
          <div className="cases-grid">
            {t.testi.cards.map((c) => (
              <div key={c.name} className="case-card reveal">
                <div className="case-stars">{[...Array(5)].map((_, i) => <span key={i}>★</span>)}</div>
                <p className="case-quote">{c.q}</p>
                <div className="case-author">
                  <Avatar src={c.avatar} name={c.name} />
                  <div className="case-meta">
                    <div className="case-name">{c.name}</div>
                    <div className="case-sector">{c.sector}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHAT YOU RECEIVE ── */}
      <section className="sec" id="receive">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="kicker">{t.recv.kicker}</span>
            <h2>{t.recv.h2}<span className="grad">{t.recv.h2grad}</span></h2>
            <p>{t.recv.lead}</p>
          </div>
          <div className="receive-grid reveal">
            {t.recv.items.map((item) => (
              <div key={item} className="receive-item">
                <div className="receive-ic">
                  <svg viewBox="0 0 24 24" width={16} height={16} stroke="var(--good)" fill="none" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CALENDLY (preserved from original page) ── */}
      <section className="sec tint" id="book-demo">
        <div className="wrap">
          <div className="sec-head reveal">
            <h2>{t.calendly.title}</h2>
            <p>{t.calendly.sub}</p>
          </div>
          <div style={{ border: "1px solid var(--accent-ring)", background: "var(--accent-tint)", borderRadius: "var(--radius)", padding: "clamp(10px,2vw,16px)", overflow: "hidden" }}>
            <Script src="https://assets.calendly.com/assets/external/widget.js" strategy="lazyOnload" />
            <div className="calendly-inline-widget" data-url="https://calendly.com/boostmybusinesses/discovertheassistant" style={{ minWidth: 320, height: 700 }} />
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="sec" id="pricing">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="kicker">{t.price.kicker}</span>
            <h2>{t.price.h2}<span className="grad">{t.price.h2grad}</span></h2>
            <p>{t.price.lead}</p>
          </div>
          <div className="pricing reveal">
            {t.price.plans.map((plan) => (
              <div key={plan.name} className={`pcard${plan.featured ? " featured" : ""}`}>
                {"badge" in plan && plan.badge && <span className="pcard-badge">{plan.badge}</span>}
                <h3>{plan.name}</h3>
                <p className="pdesc">{plan.desc}</p>
                {"priceFrom" in plan && plan.priceFrom && (
                  <>
                    <p className="price-from">{plan.priceFrom}</p>
                    <div className="price-row">
                      <span className="price-curr">{plan.curr}</span>
                      <span className="price-num">{plan.price}</span>
                    </div>
                  </>
                )}
                {"priceCustom" in plan && plan.priceCustom && (
                  <div className="price-custom">{plan.priceCustom}</div>
                )}
                <ul className="pcard-feats">
                  {plan.feats.map((f) => <li key={f}>{f}</li>)}
                </ul>
                <a className={`btn ${plan.featured ? "btn-primary" : "btn-soft"}`} href="https://www.boostmybusinesses.com/contact" target="_blank" rel="noopener noreferrer">{plan.cta}</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="cta-final">
        <div className="wrap">
          <h2>{t.cta.h2}<span style={{ opacity: 0.82 }}>{t.cta.h2dim}</span></h2>
          <p>{t.cta.p}</p>
          <div className="cta-final-btns">
            <a className="btn btn-white" href="https://www.boostmybusinesses.com/contact" target="_blank" rel="noopener noreferrer">{t.cta.btn1}</a>
            <a className="btn btn-outline" href="#agents">{t.cta.btn2}</a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="footer">
        <div className="wrap">
          <div className="footer-top">
            <div>
              <div className="footer-brand">
                <Image className="logo-mark" src="/instagram-growth/assets/icon-square-256.png" alt="" width={30} height={30} aria-hidden="true" />
                Boost<span className="brand-my">My</span>Businesses
              </div>
              <p className="footer-tagline">{t.footer.tagline}</p>
            </div>
            <div className="footer-col">
              <h4>{t.footer.col1}</h4>
              {t.footer.agents.map((a) => <Link key={a.h} href={a.h}>{a.l}</Link>)}
            </div>
            <div className="footer-col">
              <h4>{t.footer.col2}</h4>
              {t.footer.company.map((a) => <Link key={a.h} href={a.h}>{a.l}</Link>)}
            </div>
            <div className="footer-col">
              <h4>{t.footer.col3}</h4>
              {t.footer.legal.map((a) => <Link key={a.h} href={a.h}>{a.l}</Link>)}
            </div>
          </div>
          <div className="footer-bottom">
            <p>{t.footer.copy}</p>
            <p>{t.footer.registration}</p>
          </div>
        </div>
      </footer>
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
:root {
  --page-bg:#0c0e15; --surface:#13161f; --surface-2:#181b26; --surface-3:#1e2230;
  --ink:#eaecf2; --ink-dim:#9499a8; --ink-mute:#5c6170;
  --line:rgba(255,255,255,.08); --line-2:rgba(255,255,255,.04);
  --accent:#c97c10; --accent-2:#5a6cf5; --accent-ink:#ffffff;
  --accent-soft:rgba(201,124,16,.12); --accent-ring:rgba(201,124,16,.38);
  --accent-tint:rgba(201,124,16,.07);
  --card-shadow:0 24px 60px -24px rgba(0,0,0,.7),0 1px 0 rgba(255,255,255,.05) inset;
  --card-shadow-sm:0 8px 28px -12px rgba(0,0,0,.55);
  --good:#34d399; --good-bg:rgba(52,211,153,.10); --good-line:rgba(52,211,153,.25);
  --star:#f59e0b;
  --radius:20px; --radius-sm:14px; --glow:24px; --maxw:1200px;
  --font-display:"Archivo",system-ui,sans-serif;
  --font-body:"Plus Jakarta Sans",system-ui,sans-serif;
  --ig-grad:linear-gradient(135deg,#f7931e,#e1306c,#833ab4);
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:var(--font-body);background:var(--page-bg);color:var(--ink);-webkit-font-smoothing:antialiased;overflow-x:hidden}
h1,h2,h3,h4{font-family:var(--font-display);letter-spacing:-.02em}
a{color:inherit;text-decoration:none}
.wrap{width:100%;max-width:var(--maxw);margin:0 auto;padding:0 32px}

/* ---- buttons ---- */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;font-family:var(--font-display);font-weight:700;font-size:1rem;letter-spacing:-.01em;padding:15px 26px;border-radius:100px;border:none;cursor:pointer;transition:transform .18s,box-shadow .25s,background .2s,color .2s;white-space:nowrap;text-decoration:none}
.btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:var(--accent-ink);box-shadow:0 14px 34px -12px var(--accent-ring),0 0 var(--glow) var(--accent-ring)}
.btn-primary:hover{transform:translateY(-2px);box-shadow:0 20px 44px -12px var(--accent-ring)}
.btn-soft{background:var(--surface);color:var(--ink);border:1px solid var(--line);box-shadow:var(--card-shadow-sm)}
.btn-soft:hover{transform:translateY(-2px);border-color:var(--accent-ring)}
.btn-lg{padding:18px 34px;font-size:1.08rem}
.btn-sm{padding:11px 19px;font-size:.92rem}

/* ---- nav ---- */
.nav{position:sticky;top:0;z-index:60;backdrop-filter:blur(16px);border-bottom:1px solid var(--line-2);transition:background .3s}
.nav-inner{display:flex;align-items:center;gap:26px;height:72px}
.brand{display:flex;align-items:center;gap:11px;font-family:var(--font-display);font-weight:800;font-size:1.12rem;text-decoration:none;color:var(--ink)}
.brand-my{color:var(--accent)}
.logo-mark{width:36px;height:36px;border-radius:10px;flex:none;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;display:grid;place-items:center;font-weight:900;font-size:1rem;box-shadow:0 6px 18px -6px var(--accent-ring)}
.nav-links{display:flex;gap:28px;margin-left:12px}
.nav-links a{font-size:.95rem;color:var(--ink-dim);font-weight:600;transition:color .15s;text-decoration:none}
.nav-links a:hover{color:var(--accent)}
.nav-right{margin-left:auto;display:flex;align-items:center;gap:12px}
.lang-toggle{display:inline-flex;background:var(--surface-2);border:1px solid var(--line);border-radius:100px;padding:3px;font-family:var(--font-display);font-weight:700;font-size:.8rem}
.lang-toggle button{border:none;background:transparent;color:var(--ink-mute);cursor:pointer;padding:6px 13px;border-radius:100px;transition:all .18s;font-family:var(--font-display);font-weight:700;font-size:.8rem}
.lang-toggle button.on{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff}
.nav-cta-soft{color:var(--ink-dim);font-weight:600;font-size:.95rem;white-space:nowrap;text-decoration:none;transition:color .15s}
.nav-cta-soft:hover{color:var(--accent)}

/* ---- hero ---- */
.hero{background:radial-gradient(130% 90% at 70% -8%,rgba(90,108,245,.18) 0%,rgba(201,124,16,.10) 35%,#0c0e15 65%);padding:92px 0 80px;position:relative;overflow:hidden}
.hero-layout{display:grid;grid-template-columns:1fr 1fr;gap:72px;align-items:center}
.hero-tag{display:inline-flex;align-items:center;gap:8px;font-size:.82rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:var(--accent-tint);border:1px solid var(--accent-ring);padding:7px 14px;border-radius:100px;margin-bottom:24px}
.hero-tag .dot{width:7px;height:7px;border-radius:50%;background:var(--accent);flex:none}
.hero h1{font-size:clamp(2.6rem,4.4vw,4rem);line-height:1.0;font-weight:800;text-wrap:balance;letter-spacing:-.02em;margin-bottom:20px;color:var(--ink)}
.hero-sub{font-size:1.15rem;font-weight:700;color:var(--ink-dim);margin-bottom:14px}
.lead{font-size:1.05rem;line-height:1.6;color:var(--ink-dim);max-width:48ch;text-wrap:pretty;margin-bottom:32px}
.hero-cta{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:28px}
.hero-benefits{display:flex;flex-direction:column;gap:10px}
.hero-benefit{display:flex;align-items:center;gap:10px;font-size:.94rem;font-weight:600;color:var(--ink-dim)}
.hero-benefit .ck{width:20px;height:20px;border-radius:50%;background:var(--good-bg);border:1px solid var(--good-line);display:grid;place-items:center;font-size:.72rem;color:var(--good);font-weight:900;flex:none}
.hero-stats{display:flex;flex-direction:column;gap:16px}
.hstat{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:24px 26px;box-shadow:var(--card-shadow-sm);display:flex;align-items:center;gap:20px;transition:transform .2s,box-shadow .2s}
.hstat:hover{transform:translateY(-3px);box-shadow:var(--card-shadow)}
.hstat-num{font-family:var(--font-display);font-weight:900;font-size:2.4rem;letter-spacing:-.03em;background:linear-gradient(135deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent;line-height:1;min-width:80px}
.hstat-title{font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:4px;color:var(--ink)}
.hstat-desc{font-size:.88rem;color:var(--ink-mute);line-height:1.4}

/* ---- section base ---- */
.sec{padding:100px 0;background:var(--page-bg)}
.sec.tint{background:var(--surface-2)}
.sec-head{max-width:700px;margin:0 auto 56px;text-align:center}
.kicker{display:inline-block;font-family:var(--font-display);font-weight:700;font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:14px}
.sec-head h2{font-size:clamp(1.9rem,3.6vw,3rem);line-height:1.06;font-weight:800;text-wrap:balance}
.sec-head p{margin-top:14px;font-size:1.08rem;color:var(--ink-dim);line-height:1.55;text-wrap:pretty}
.grad{background:linear-gradient(110deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}

/* ---- services ---- */
.services-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
.svc-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:32px 28px;box-shadow:var(--card-shadow-sm);display:grid;grid-template-rows:auto auto 1fr auto;gap:12px;transition:transform .22s,box-shadow .22s,border-color .22s}
.svc-card:hover{transform:translateY(-4px);box-shadow:var(--card-shadow);border-color:var(--accent-ring)}
.svc-icon{width:50px;height:50px;border-radius:14px;background:var(--accent-tint);display:grid;place-items:center}
.svc-card h3{font-size:1.18rem;font-weight:800;color:var(--ink)}
.svc-card p{font-size:.98rem;color:var(--ink-dim);line-height:1.5}
.svc-outcome{display:inline-flex;align-items:center;gap:6px;font-size:.82rem;font-weight:700;color:var(--accent);background:var(--accent-soft);padding:5px 12px;border-radius:100px;align-self:start}

/* ---- agents ---- */
.agents-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.agent-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:26px 22px;box-shadow:var(--card-shadow-sm);display:flex;flex-direction:column;gap:12px;transition:transform .22s,box-shadow .22s,border-color .22s}
.agent-card:hover{transform:translateY(-4px);box-shadow:var(--card-shadow);border-color:var(--accent-ring)}
.agent-num{font-family:var(--font-display);font-weight:800;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);opacity:.7}
.agent-card h3{font-size:1.08rem;font-weight:800;line-height:1.25;color:var(--ink)}
.agent-card p{font-size:.94rem;color:var(--ink-dim);line-height:1.45;flex:1}
.agent-outcome{font-size:.82rem;font-weight:700;color:var(--good);background:var(--good-bg);border:1px solid var(--good-line);padding:5px 11px;border-radius:100px;display:inline-flex;align-items:center;gap:5px;align-self:flex-start}
.agent-link{display:flex;align-items:center;justify-content:center;gap:8px;font-size:.85rem;font-weight:700;color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent-ring);padding:11px 18px;border-radius:100px;margin-top:8px;width:100%;transition:background .18s,gap .18s,box-shadow .18s,transform .18s;text-decoration:none}
.agent-link:hover{background:var(--accent);color:var(--accent-ink);gap:12px;transform:translateY(-1px);box-shadow:0 8px 22px -8px var(--accent-ring)}

/* ---- use cases tabs ---- */
.sector-tabs{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:44px}
.sector-tab{font-family:var(--font-display);font-weight:700;font-size:.88rem;padding:9px 18px;border-radius:100px;border:1px solid var(--line);background:var(--surface);color:var(--ink-mute);cursor:pointer;transition:all .18s}
.sector-tab:hover{border-color:var(--accent-ring);color:var(--accent)}
.sector-tab.on{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;border-color:transparent;box-shadow:0 8px 22px -8px var(--accent-ring)}
.sector-panel{display:none;animation:fadein .3s ease}
.sector-panel.on{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
@keyframes fadein{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.sector-text h3{font-size:1.6rem;font-weight:800;margin-bottom:14px;color:var(--ink)}
.sector-text p{font-size:1.02rem;color:var(--ink-dim);line-height:1.6;margin-bottom:22px}
.sector-bullets{list-style:none;display:flex;flex-direction:column;gap:12px}
.sector-bullets li{display:flex;align-items:flex-start;gap:12px;font-size:.96rem;color:var(--ink-dim)}
.sector-bullets li::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none;margin-top:7px}
.sector-visual{position:relative;border-radius:var(--radius);overflow:hidden;min-height:340px;display:flex;flex-direction:column;justify-content:flex-end}
.sector-visual-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .6s ease}
.sector-panel.on .sector-visual-img{transform:scale(1.03)}
.sector-visual:hover .sector-visual-img{transform:scale(1.06)}
.sector-visual-overlay{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.82) 0%,rgba(0,0,0,.3) 55%,rgba(0,0,0,.0) 100%)}
.sector-visual-content{position:relative;z-index:2;padding:28px 26px}
.sector-stat-pill{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.10);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.18);border-radius:100px;padding:8px 16px;margin-bottom:14px}
.sp-num{font-family:var(--font-display);font-weight:900;font-size:1.2rem;color:#fff;letter-spacing:-.02em}
.sp-label{font-size:.8rem;color:rgba(255,255,255,.75);font-weight:600}
.sector-visual-title{font-family:var(--font-display);font-weight:800;font-size:1.3rem;color:#fff;line-height:1.2}

/* ---- testimonials ---- */
.cases-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.case-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:32px 28px 26px;box-shadow:var(--card-shadow-sm);display:flex;flex-direction:column;gap:0;transition:transform .25s,box-shadow .25s,border-color .25s;position:relative;overflow:hidden}
.case-card::before{content:"\\201C";position:absolute;top:18px;right:24px;font-family:Georgia,serif;font-size:7rem;line-height:1;color:var(--accent);opacity:.10;pointer-events:none}
.case-card:hover{transform:translateY(-5px);box-shadow:var(--card-shadow);border-color:var(--accent-ring)}
.case-stars{display:flex;gap:3px;margin-bottom:18px;color:var(--star);font-size:1rem}
.case-quote{font-size:1rem;line-height:1.65;color:var(--ink-dim);flex:1;margin-bottom:26px}
.case-author{display:flex;align-items:center;gap:14px;padding-top:20px;border-top:1px solid var(--line)}
.case-avatar{width:46px;height:46px;border-radius:50%;object-fit:cover;flex:none;border:2px solid var(--accent-ring)}
.case-name{font-family:var(--font-display);font-weight:800;font-size:.96rem;color:var(--ink)}
.case-sector{font-size:.8rem;color:var(--ink-mute)}

/* ---- what you receive ---- */
.receive-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;max-width:720px;margin:0 auto}
.receive-item{display:flex;align-items:center;gap:13px;padding:16px 18px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-sm);box-shadow:var(--card-shadow-sm)}
.receive-ic{width:32px;height:32px;border-radius:9px;background:var(--good-bg);border:1px solid var(--good-line);display:grid;place-items:center;flex:none}
.receive-item span{font-size:.95rem;font-weight:600;line-height:1.35;color:var(--ink)}

/* ---- pricing ---- */
.pricing{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.pcard{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:32px 26px;box-shadow:var(--card-shadow-sm);display:flex;flex-direction:column;gap:0;transition:transform .22s,box-shadow .22s}
.pcard.featured{border-color:var(--accent-ring);box-shadow:var(--card-shadow),0 0 0 1px var(--accent-ring)}
.pcard:hover{transform:translateY(-4px);box-shadow:var(--card-shadow)}
.pcard-badge{display:inline-block;font-family:var(--font-display);font-weight:700;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;padding:5px 12px;border-radius:100px;margin-bottom:14px;align-self:flex-start}
.pcard h3{font-size:1.22rem;font-weight:800;margin-bottom:6px;color:var(--ink)}
.pdesc{font-size:.94rem;color:var(--ink-mute);margin-bottom:22px;line-height:1.4}
.price-from{font-size:.82rem;color:var(--ink-mute);margin-bottom:2px}
.price-row{display:flex;align-items:baseline;gap:3px;margin-bottom:22px}
.price-curr{font-family:var(--font-display);font-weight:700;font-size:1.2rem;color:var(--ink-mute)}
.price-num{font-family:var(--font-display);font-weight:900;font-size:2.6rem;letter-spacing:-.03em;color:var(--ink)}
.price-custom{font-family:var(--font-display);font-weight:900;font-size:1.8rem;color:var(--ink);margin-bottom:22px}
.pcard-feats{list-style:none;display:flex;flex-direction:column;gap:10px;margin-bottom:26px;flex:1}
.pcard-feats li{display:flex;align-items:flex-start;gap:10px;font-size:.94rem;color:var(--ink-dim)}
.pcard-feats li::before{content:"✓";color:var(--good);font-weight:900;flex:none;margin-top:1px}
.pcard .btn{width:100%;justify-content:center}

/* ---- final cta ---- */
.cta-final{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;padding:100px 0;text-align:center;position:relative;overflow:hidden}
.cta-final::before{content:"";position:absolute;inset:0;background:radial-gradient(80% 60% at 50% 0%,rgba(255,255,255,.14),transparent)}
.cta-final h2{font-family:var(--font-display);font-weight:900;font-size:clamp(2rem,4vw,3.4rem);letter-spacing:-.02em;text-wrap:balance;margin-bottom:14px;position:relative}
.cta-final p{font-size:1.1rem;opacity:.88;max-width:500px;margin:0 auto 34px;line-height:1.5;position:relative}
.cta-final-btns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;position:relative}
.btn-white{background:#fff;color:var(--accent);font-family:var(--font-display);font-weight:800;padding:18px 36px;border-radius:100px;text-decoration:none;display:inline-flex;align-items:center;transition:transform .18s}
.btn-white:hover{transform:translateY(-2px)}
.btn-outline{background:transparent;border:2px solid rgba(255,255,255,.6);color:#fff;font-family:var(--font-display);font-weight:700;padding:18px 36px;border-radius:100px;text-decoration:none;display:inline-flex;align-items:center;transition:background .18s,transform .18s}
.btn-outline:hover{background:rgba(255,255,255,.12);transform:translateY(-2px)}

/* ---- footer ---- */
.footer{background:var(--surface-2);border-top:1px solid var(--line);padding:52px 0 32px}
.footer-top{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;gap:40px;margin-bottom:44px}
.footer-brand{font-family:var(--font-display);font-weight:800;font-size:1.05rem;margin-bottom:10px;display:flex;align-items:center;gap:10px;color:var(--ink)}
.footer-brand .logo-mark{width:30px;height:30px;font-size:.88rem}
.footer-tagline{font-size:.9rem;color:var(--ink-dim);line-height:1.5}
.footer-col h4{font-family:var(--font-display);font-weight:700;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:13px}
.footer-col a{display:block;font-size:.9rem;color:var(--ink-dim);margin-bottom:8px;transition:color .15s;text-decoration:none}
.footer-col a:hover{color:var(--accent)}
.footer-bottom{display:flex;align-items:center;justify-content:space-between;padding-top:22px;border-top:1px solid var(--line-2);flex-wrap:wrap;gap:10px}
.footer-bottom p{font-size:.86rem;color:var(--ink-mute)}

/* ---- reveal ---- */
.reveal{opacity:0;transform:translateY(26px);transition:opacity .55s ease,transform .55s ease}
.reveal.in{opacity:1;transform:none}
.reveal[data-delay="1"]{transition-delay:.1s}
.reveal[data-delay="2"]{transition-delay:.2s}
.reveal[data-delay="3"]{transition-delay:.3s}

/* ---- ig hero card ---- */
.ig-card-wrap{display:block;text-decoration:none;border-radius:var(--radius);overflow:hidden;box-shadow:var(--card-shadow);transition:transform .25s,box-shadow .25s}
.ig-card-wrap:hover{transform:translateY(-5px) scale(1.01);box-shadow:0 36px 80px -28px rgba(0,0,0,.7),0 0 0 1px rgba(225,48,108,.35)}
.ig-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.ig-card-top{background:var(--ig-grad);padding:22px 22px 18px;position:relative;overflow:hidden}
.ig-card-top::before{content:"";position:absolute;inset:0;background:radial-gradient(80% 80% at 70% 20%,rgba(255,255,255,.15),transparent)}
.ig-badge{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.15);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.25);border-radius:100px;padding:5px 12px;margin-bottom:14px}
.ig-badge span{font-family:var(--font-display);font-weight:700;font-size:.75rem;color:#fff;letter-spacing:.06em;text-transform:uppercase}
.ig-live-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;flex:none;animation:igpulse 1.6s ease-in-out infinite}
@keyframes igpulse{0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,.7)}50%{box-shadow:0 0 0 6px rgba(74,222,128,0)}}
.ig-count-wrap{display:flex;align-items:baseline;gap:6px;position:relative;z-index:1}
.ig-count{font-family:var(--font-display);font-weight:900;font-size:2.8rem;letter-spacing:-.03em;color:#fff;line-height:1}
.ig-count-label{font-size:.95rem;font-weight:600;color:rgba(255,255,255,.75)}
.ig-count-sub{font-size:.82rem;color:rgba(255,255,255,.6);margin-top:4px;position:relative;z-index:1}
.ig-bars{display:flex;align-items:flex-end;gap:4px;height:32px;margin-top:10px;position:relative;z-index:1}
.ig-bar{flex:1;border-radius:3px 3px 0 0;background:rgba(255,255,255,.25);animation:igbar 1.8s ease-in-out infinite alternate}
.ig-bar:nth-child(1){height:40%;animation-delay:0s}.ig-bar:nth-child(2){height:65%;animation-delay:.15s}.ig-bar:nth-child(3){height:85%;animation-delay:.3s}.ig-bar:nth-child(4){height:55%;animation-delay:.45s}.ig-bar:nth-child(5){height:90%;animation-delay:.6s}.ig-bar:nth-child(6){height:70%;animation-delay:.75s}.ig-bar:nth-child(7){height:100%;animation-delay:.9s}
@keyframes igbar{to{opacity:.6;transform:scaleY(.7);transform-origin:bottom}}
.ig-card-body{padding:18px 20px;display:flex;flex-direction:column;gap:10px}
.ig-card-title{font-family:var(--font-display);font-weight:800;font-size:1.08rem;color:var(--ink)}
.ig-card-desc{font-size:.9rem;color:var(--ink-dim);line-height:1.45}
.ig-card-cta{display:flex;align-items:center;justify-content:center;gap:8px;font-family:var(--font-display);font-weight:700;font-size:.88rem;color:#fff;background:var(--ig-grad);padding:12px;border-radius:10px;margin-top:4px;transition:opacity .18s,transform .18s}
.ig-card-wrap:hover .ig-card-cta{opacity:.88;transform:translateY(-1px)}

/* ---- ig growth section ---- */
.ig-growth-sec{background:radial-gradient(ellipse 130% 70% at 90% 50%,rgba(225,48,108,.10) 0%,rgba(131,58,180,.06) 45%,transparent 70%),var(--page-bg);overflow:hidden;position:relative}
.ig-growth-sec::after{content:"";position:absolute;top:-180px;right:-180px;width:640px;height:640px;border-radius:50%;background:radial-gradient(circle,rgba(225,48,108,.07) 0%,transparent 70%);pointer-events:none}
.ig-growth-layout{display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}
.ig-growth-kicker{padding:7px 16px;border-radius:100px;background:rgba(225,48,108,.10);border:1px solid rgba(225,48,108,.28)}
.ig-growth-kicker span{font-family:var(--font-display);font-weight:700;font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;background:var(--ig-grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.ig-grad-text{background:var(--ig-grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.ig-growth-feats{display:flex;flex-direction:column;gap:18px;margin-bottom:32px}
.ig-growth-feat{display:flex;align-items:flex-start;gap:14px}
.ig-feat-ic{width:40px;height:40px;border-radius:12px;flex:none;background:rgba(225,48,108,.10);border:1px solid rgba(225,48,108,.22);display:grid;place-items:center}
.ig-feat-body strong{font-family:var(--font-display);font-weight:700;font-size:.97rem;display:block;margin-bottom:2px;color:var(--ink)}
.ig-feat-body p{font-size:.88rem;color:var(--ink-dim);line-height:1.4;margin:0}
.ig-growth-stats-row{display:flex;gap:32px;margin-bottom:36px;flex-wrap:wrap;padding:20px 22px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-sm);box-shadow:var(--card-shadow-sm)}
.ig-gs{display:flex;flex-direction:column;gap:2px}
.ig-gs-num{font-family:var(--font-display);font-weight:900;font-size:1.75rem;letter-spacing:-.03em;background:var(--ig-grad);-webkit-background-clip:text;background-clip:text;color:transparent;line-height:1}
.ig-gs-label{font-size:.8rem;color:var(--ink-mute);font-weight:600;line-height:1.3}
.ig-growth-cta{display:flex;gap:12px;flex-wrap:wrap}
.ig-growth-visual{position:relative;z-index:1}
.ig-visual-card{background:var(--surface);border:1px solid rgba(225,48,108,.18);border-radius:var(--radius);overflow:hidden;box-shadow:var(--card-shadow),0 0 80px -20px rgba(225,48,108,.18)}
.ig-visual-header{background:var(--ig-grad);padding:22px 22px 16px;position:relative;overflow:hidden}
.ig-visual-header::before{content:"";position:absolute;inset:0;background:radial-gradient(80% 80% at 70% 20%,rgba(255,255,255,.16),transparent)}
.ig-vprofile{display:flex;align-items:center;gap:12px;margin-bottom:16px;position:relative;z-index:1}
.ig-vavatar{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.5);display:grid;place-items:center;font-family:var(--font-display);font-weight:800;font-size:1rem;color:#fff;flex:none}
.ig-vinfo strong{display:block;font-family:var(--font-display);font-weight:800;font-size:.94rem;color:#fff}
.ig-vinfo span{font-size:.78rem;color:rgba(255,255,255,.72)}
.ig-vlive{margin-left:auto;display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.15);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.25);border-radius:100px;padding:5px 11px;font-family:var(--font-display);font-weight:700;font-size:.7rem;color:#fff;letter-spacing:.06em;text-transform:uppercase}
.ig-vcounter-row{position:relative;z-index:1}
.ig-vcounter-big{font-family:var(--font-display);font-weight:900;font-size:2.9rem;color:#fff;letter-spacing:-.04em;line-height:1}
.ig-vcounter-sub{font-size:.82rem;color:rgba(255,255,255,.68);margin-top:4px}
.ig-vsparkline{display:flex;align-items:flex-end;gap:3px;height:30px;margin-top:12px;position:relative;z-index:1}
.ig-vspark{flex:1;border-radius:2px 2px 0 0;background:rgba(255,255,255,.28);animation:igvspark 2.4s ease-in-out infinite alternate}
.ig-vspark:nth-child(1){height:28%;animation-delay:0s}.ig-vspark:nth-child(2){height:44%;animation-delay:.2s}.ig-vspark:nth-child(3){height:36%;animation-delay:.4s}.ig-vspark:nth-child(4){height:62%;animation-delay:.6s}.ig-vspark:nth-child(5){height:50%;animation-delay:.8s}.ig-vspark:nth-child(6){height:78%;animation-delay:1s}.ig-vspark:nth-child(7){height:68%;animation-delay:1.2s}.ig-vspark:nth-child(8){height:88%;animation-delay:1.4s}.ig-vspark:nth-child(9){height:76%;animation-delay:1.6s}.ig-vspark:nth-child(10){height:100%;animation-delay:1.8s}
@keyframes igvspark{to{opacity:.55;transform:scaleY(.72);transform-origin:bottom}}
.ig-vactivity{padding:14px 20px;display:flex;flex-direction:column;gap:0}
.ig-vact-title{font-family:var(--font-display);font-weight:700;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:8px}
.ig-vact-item{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line-2);font-size:.86rem;animation:igfadein .4s ease}
.ig-vact-item:last-child{border-bottom:none}
@keyframes igfadein{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.ig-vact-dot{width:8px;height:8px;border-radius:50%;background:var(--good);flex:none;box-shadow:0 0 7px rgba(52,211,153,.55);animation:igpulse 2s ease-in-out infinite}
.ig-vact-text{flex:1;color:var(--ink-dim)}
.ig-vact-text strong{color:var(--ink);font-weight:600}
.ig-vact-geo{font-size:.74rem;color:var(--ink-mute);font-weight:600;background:var(--surface-2);padding:3px 8px;border-radius:100px;border:1px solid var(--line);white-space:nowrap}
.ig-vtrust{display:flex;align-items:center;gap:6px;padding:11px 20px;background:var(--surface-2);border-top:1px solid var(--line);flex-wrap:wrap}
.ig-vtrust-item{display:inline-flex;align-items:center;gap:5px;font-family:var(--font-display);font-weight:700;font-size:.72rem;color:var(--ink-dim)}
.ig-vtrust-sep{width:3px;height:3px;border-radius:50%;background:var(--ink-mute);opacity:.3;flex:none}
.ig-vfloat{position:absolute;bottom:-18px;left:-22px;background:var(--surface);border:1px solid rgba(225,48,108,.25);border-radius:var(--radius-sm);padding:13px 18px;box-shadow:var(--card-shadow),0 0 30px -8px rgba(225,48,108,.18);display:flex;align-items:center;gap:12px;min-width:180px;z-index:2}
.ig-vfloat-num{font-family:var(--font-display);font-weight:900;font-size:1.7rem;letter-spacing:-.03em;background:var(--ig-grad);-webkit-background-clip:text;background-clip:text;color:transparent;line-height:1}
.ig-vfloat-text{display:flex;flex-direction:column;gap:1px}
.ig-vfloat-text strong{font-family:var(--font-display);font-weight:700;font-size:.85rem;line-height:1.2;color:var(--ink)}
.ig-vfloat-text span{font-size:.74rem;color:var(--ink-mute)}

/* ---- responsive ---- */
@media(max-width:1024px){
  .agents-grid{grid-template-columns:repeat(2,1fr)}
  .hero-layout{grid-template-columns:1fr;gap:48px}
  .hero-stats{flex-direction:row;flex-wrap:wrap}
  .hstat{flex:1;min-width:200px}
  .ig-growth-layout{grid-template-columns:1fr;gap:48px}
}
@media(max-width:768px){
  .services-grid,.cases-grid,.pricing,.footer-top{grid-template-columns:1fr}
  .agents-grid{grid-template-columns:1fr}
  .sector-panel.on{grid-template-columns:1fr}
  .sector-visual{min-height:240px;order:-1}
  .nav-links{display:none}
  .receive-grid{grid-template-columns:1fr}
  .wrap{padding:0 20px}
  .hero{padding:60px 0 48px}
  .sec{padding:72px 0}
}
@media(max-width:480px){
  .footer-top{grid-template-columns:1fr 1fr}
  .hero-cta{flex-direction:column}
}
`;
