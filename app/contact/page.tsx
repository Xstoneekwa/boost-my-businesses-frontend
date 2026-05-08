import type { Metadata } from "next";
import LegalPageShell, { type LegalSection } from "../components/LegalPageShell";

export const metadata: Metadata = {
  title: "Contact BoostMyBusinesses | BoostMyBusinesses",
};

const sections: LegalSection[] = [
  {
    title: "Primary contact",
    body: ["For business inquiries, product questions, or support requests, contact:"],
    contact: "growth@boostmybusinesses.com",
    contactPlacement: "beforeList",
    bodyAfterContact: ["We use this inbox for:"],
    list: ["Business inquiries", "Product questions", "Support requests"],
  },
];

export default function ContactPage() {
  return (
    <LegalPageShell
      eyebrow="Contact"
      title="Contact BoostMyBusinesses"
      intro="Have a question about our AI automation services? Contact us and we'll get back to you."
      sections={sections}
    />
  );
}
