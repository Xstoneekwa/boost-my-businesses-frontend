import LegalPageShell, { type LegalSection } from "../components/LegalPageShell";

const sections: LegalSection[] = [
  {
    title: "Information We Collect",
    body: ["We may collect the following types of information:"],
    list: [
      "name",
      "email address",
      "phone number",
      "business information",
      "communication details",
      "usage data and analytics data",
      "any information you voluntarily submit through forms, email, or calls",
    ],
  },
  {
    title: "How We Use Your Information",
    body: ["We use your information to:"],
    list: [
      "provide and improve our services",
      "communicate with you",
      "respond to inquiries",
      "deliver purchased services",
      "manage subscriptions and billing",
      "analyze website usage and service performance",
      "protect our business against fraud or misuse",
    ],
  },
  {
    title: "Payments",
    body: [
      "Payments are processed securely by third-party payment providers, including Paddle.",
      "We do not store your full payment card details on our own servers.",
    ],
  },
  {
    title: "Data Sharing",
    body: [
      "We do not sell your personal data.",
      "We may share information with trusted third-party providers only when necessary to operate our business, including:",
    ],
    list: [
      "payment processors",
      "hosting providers",
      "analytics tools",
      "communication and automation platforms",
    ],
  },
  {
    title: "Data Retention",
    body: [
      "We retain personal data only for as long as necessary to provide services, comply with legal obligations, resolve disputes, and enforce our agreements.",
    ],
  },
  {
    title: "Data Security",
    body: [
      "We implement reasonable technical and organizational measures to protect your personal information against unauthorized access, loss, misuse, or disclosure. However, no method of transmission or storage is completely secure.",
    ],
  },
  {
    title: "Your Rights",
    body: ["Depending on your location, you may have the right to:"],
    list: [
      "request access to your personal data",
      "request correction of inaccurate information",
      "request deletion of your data",
      "object to certain processing activities",
      "opt out of marketing communications",
    ],
  },
  {
    title: "Cookies and Analytics",
    body: [
      "Our website may use cookies and similar technologies to improve user experience, understand website traffic, and analyze performance.",
    ],
  },
  {
    title: "Third-Party Links",
    body: [
      "Our website may contain links to third-party websites. We are not responsible for the privacy practices of those external websites.",
    ],
  },
  {
    title: "Updates to This Policy",
    body: [
      "We may update this Privacy Policy from time to time. Any updates will be posted on this page with the revised effective date.",
    ],
  },
  {
    title: "Contact",
    body: ["If you have any questions about this Privacy Policy or your data, please contact:"],
    contact: "growth@boostmybusinesses.com",
  },
];

export default function PrivacyPolicyClient() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      intro="This Privacy Policy explains how BoostMyBusinesses collects, uses, stores, and protects your information when you visit our website or use our services."
      sections={sections}
    />
  );
}
