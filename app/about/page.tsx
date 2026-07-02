import type { Metadata } from "next";
import LegalPageShell, {
  type LegalPageContent,
  type LegalSection,
} from "../components/LegalPageShell";

export const metadata: Metadata = {
  title: "About Boost My Businesses Ltd | BoostMyBusinesses",
};

const address = "167-169 Great Portland Street, 5th Floor, London, W1W 5PF";

const sectionsEn: LegalSection[] = [
  {
    title: "Our company",
    body: [
      `Boost My Businesses Ltd is a limited company incorporated in England and Wales in 2026 under Company No. 17313018. Our registered office is ${address}, United Kingdom.`,
    ],
  },
  {
    title: "What we do",
    body: [
      "We design and operate AI-powered automation services that help businesses manage customer communications, leads, calls, social growth campaigns and operational workflows.",
    ],
  },
  {
    title: "Our services",
    body: [
      "Our solutions include Instagram Growth, AI call assistants, WhatsApp lead automation, AI-assisted advertising content, custom agents, integrations and workflow automation.",
    ],
  },
  {
    title: "Who we help",
    body: [
      "We work with restaurants, service businesses and growth-focused organisations in Europe and internationally.",
    ],
  },
  {
    title: "Contact",
    body: ["For company or business enquiries, contact:"],
    contact: "growth@boostmybusinesses.com",
  },
];

const sectionsFr: LegalSection[] = [
  {
    title: "Notre société",
    body: [
      `Boost My Businesses Ltd est une société à responsabilité limitée immatriculée en Angleterre et au Pays de Galles en 2026 sous le numéro 17313018. Son siège social est situé ${address}, Royaume-Uni.`,
    ],
  },
  {
    title: "Notre activité",
    body: [
      "Nous concevons et opérons des services d'automatisation par IA pour aider les entreprises à gérer leurs communications clients, prospects, appels, campagnes de croissance sociale et processus opérationnels.",
    ],
  },
  {
    title: "Nos services",
    body: [
      "Nos solutions comprennent Instagram Growth, les assistants d'appel IA, l'automatisation des prospects WhatsApp, les contenus publicitaires assistés par IA, les agents sur mesure, les intégrations et l'automatisation de workflows.",
    ],
  },
  {
    title: "Nos clients",
    body: [
      "Nous accompagnons des restaurants, entreprises de services et organisations orientées croissance en Europe et à l'international.",
    ],
  },
  {
    title: "Contact",
    body: ["Pour toute demande relative à la société ou à nos services :"],
    contact: "growth@boostmybusinesses.com",
  },
];

const content: Record<"fr" | "en", LegalPageContent> = {
  en: {
    eyebrow: "Company",
    title: "About Boost My Businesses Ltd",
    intro: "AI automation designed for practical business operations, customer communication and growth.",
    sections: sectionsEn,
  },
  fr: {
    eyebrow: "Entreprise",
    title: "À propos de Boost My Businesses Ltd",
    intro: "Des automatisations IA conçues pour les opérations, la communication client et la croissance des entreprises.",
    sections: sectionsFr,
  },
};

export default function AboutPage() {
  return <LegalPageShell content={content} />;
}
