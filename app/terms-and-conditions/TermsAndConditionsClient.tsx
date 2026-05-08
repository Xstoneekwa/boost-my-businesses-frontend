import LegalPageShell, { type LegalSection } from "../components/LegalPageShell";

const sections: LegalSection[] = [
  {
    title: "Overview",
    body: [
      "BoostMyBusinesses provides AI-powered tools, automation systems, and digital business services for businesses looking to improve operations, lead handling, customer communication, and growth.",
    ],
  },
  {
    title: "Acceptance of Terms",
    body: [
      "By accessing our website or using our services, you agree to be bound by these Terms of Service. If you do not agree, please do not use our website or services.",
    ],
  },
  {
    title: "Services",
    body: [
      "Our services may include, but are not limited to:",
      "We reserve the right to update, modify, or discontinue any service at any time.",
    ],
    list: [
      "AI call assistants",
      "lead generation systems",
      "workflow automations",
      "AI-powered business tools",
      "consulting and implementation services",
    ],
  },
  {
    title: "User Responsibilities",
    body: ["You agree to:"],
    list: [
      "provide accurate and complete information",
      "use our services in a lawful manner",
      "not misuse, interfere with, or attempt to disrupt our systems or services",
      "not use our services for fraudulent, abusive, or unauthorized purposes",
    ],
  },
  {
    title: "Payments",
    body: [
      "Payments for our services are processed securely through third-party payment providers, including Paddle.",
      "By purchasing a service or subscription, you agree to pay all applicable fees and charges.",
      "If a service is subscription-based, you authorize recurring billing according to the plan selected at checkout.",
    ],
  },
  {
    title: "No Guarantee of Results",
    body: [
      "We do not guarantee specific business outcomes, including but not limited to revenue growth, number of leads, bookings, conversions, or sales. Results depend on many factors outside our control.",
    ],
  },
  {
    title: "Intellectual Property",
    body: [
      "All content, branding, materials, systems, and website elements provided by BoostMyBusinesses remain our property unless otherwise agreed in writing. You may not copy, reproduce, distribute, or exploit any part of our website or services without prior written consent.",
    ],
  },
  {
    title: "Limitation of Liability",
    body: [
      "To the maximum extent permitted by law, BoostMyBusinesses shall not be liable for any indirect, incidental, special, consequential, or business-related damages, including loss of profits, loss of data, or service interruption.",
    ],
  },
  {
    title: "Termination",
    body: [
      "We reserve the right to suspend or terminate access to our services if a user violates these Terms of Service or uses the services in a harmful, abusive, or unlawful way.",
    ],
  },
  {
    title: "Governing Law",
    body: ["These Terms of Service are governed by the laws of South Africa."],
  },
  {
    title: "Contact",
    body: ["If you have any questions regarding these Terms of Service, please contact:"],
    contact: "growth@boostmybusinesses.com",
  },
];

export default function TermsAndConditionsClient() {
  return (
    <LegalPageShell
      title="Terms of Service"
      intro="These Terms of Service govern your access to and use of the BoostMyBusinesses website and services. By using our website or purchasing our services, you agree to these terms."
      sections={sections}
    />
  );
}
