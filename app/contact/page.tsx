import type { Metadata } from "next";
import LegalPageShell, {
  type LegalPageContent,
  type LegalSection,
} from "../components/LegalPageShell";

export const metadata: Metadata = {
  title: "Contact Boost My Businesses Ltd | BoostMyBusinesses",
};

const sectionsEn: LegalSection[] = [
  {
    title: "Email",
    body: ["For sales, product, support, billing, privacy or legal enquiries, contact:"],
    contact: "growth@boostmybusinesses.com",
  },
  {
    title: "Legal and registered office",
    body: [
      "Boost My Businesses Ltd",
      "Registered in England & Wales, Company No. 17313018",
      "167-169 Great Portland Street, 5th Floor, London, W1W 5PF, United Kingdom",
    ],
  },
];

const sectionsFr: LegalSection[] = [
  {
    title: "Email",
    body: ["Pour toute demande commerciale, produit, assistance, facturation, confidentialité ou juridique :"],
    contact: "growth@boostmybusinesses.com",
  },
  {
    title: "Identité et adresse légale",
    body: [
      "Boost My Businesses Ltd",
      "Immatriculée en Angleterre et au Pays de Galles, société n° 17313018",
      "167-169 Great Portland Street, 5th Floor, London, W1W 5PF, Royaume-Uni",
    ],
  },
];

const content: Record<"fr" | "en", LegalPageContent> = {
  en: {
    eyebrow: "Contact",
    title: "Contact Boost My Businesses Ltd",
    intro: "Contact our team about our AI automation services or your account.",
    sections: sectionsEn,
  },
  fr: {
    eyebrow: "Contact",
    title: "Contacter Boost My Businesses Ltd",
    intro: "Contactez notre équipe au sujet de nos services d'automatisation IA ou de votre compte.",
    sections: sectionsFr,
  },
};

export default function ContactPage() {
  return <LegalPageShell content={content} />;
}
