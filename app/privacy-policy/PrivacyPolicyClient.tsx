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
    title: "Instagram Growth Service — Social Media Data",
    body: [
      "If you use our Instagram Growth service, we collect and process additional data to operate and optimise your campaign, including:",
    ],
    list: [
      "Instagram account credentials or access tokens you provide",
      "Instagram account activity data (follower counts, engagement metrics, follow/unfollow logs)",
      "target audience parameters you configure (competitor accounts, geographic zones, hashtags)",
      "campaign performance reports and analytics generated through the service",
    ],
    bodyAfterList: [
      "This data is used solely to deliver, monitor, and report on your Instagram Growth campaign. Your credentials are transmitted over encrypted connections and are never shared with third parties except as required to operate the service (e.g. proxy and infrastructure providers).",
      "You may request deletion of this data at any time by contacting us at growth@boostmybusinesses.com.",
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
      "analyse website usage and service performance",
      "protect our business against fraud or misuse",
    ],
  },
  {
    title: "Payments",
    body: [
      "Payments are processed securely by Paddle (paddle.com), our authorised reseller and Merchant of Record.",
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
      "payment processors (Paddle)",
      "hosting and infrastructure providers",
      "analytics tools",
      "communication and automation platforms",
      "proxy and device infrastructure providers (Instagram Growth service only)",
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
      "We implement reasonable technical and organisational measures to protect your personal information against unauthorised access, loss, misuse, or disclosure. However, no method of transmission or storage is completely secure.",
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
      "Our website may use cookies and similar technologies to improve user experience, understand website traffic, and analyse performance.",
    ],
  },
  {
    title: "Third-Party Links",
    body: [
      "Our website may contain links to third-party websites, including Meta and Instagram. We are not responsible for the privacy practices of those external websites.",
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
      intro="This Privacy Policy explains how Dibu Business Trading (trading as BoostMyBusinesses) collects, uses, stores, and protects your information when you visit our website or use our services — including our Instagram Growth service, UGC Ads Engine, WhatsApp Lead System, AI Call Assistant, and all other digital products. Effective date: 2 June 2026."
      sections={sections}
    />
  );
}
