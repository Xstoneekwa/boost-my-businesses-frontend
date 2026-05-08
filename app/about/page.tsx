import type { Metadata } from "next";
import LegalPageShell, { type LegalSection } from "../components/LegalPageShell";

export const metadata: Metadata = {
  title: "About BoostMyBusinesses | BoostMyBusinesses",
};

const sections: LegalSection[] = [
  {
    title: "What we do",
    body: [
      "We create AI automation systems that help businesses save time, respond faster, and handle customer interactions more efficiently.",
    ],
  },
  {
    title: "Our focus",
    body: [
      "Our current solutions include AI call assistants, WhatsApp lead automation, customer support automation, and workflow automation for business operations.",
    ],
  },
  {
    title: "Who we help",
    body: [
      "We help restaurants, service businesses, and growth-focused companies automate repetitive communication and operational tasks.",
    ],
  },
  {
    title: "Contact",
    body: ["For business inquiries, contact:"],
    contact: "growth@boostmybusinesses.com",
  },
];

export default function AboutPage() {
  return (
    <LegalPageShell
      eyebrow="Company"
      title="About BoostMyBusinesses"
      intro="BoostMyBusinesses builds AI-powered automation tools for businesses that want to improve customer communication, lead handling, phone call management, and operational workflows."
      sections={sections}
    />
  );
}
