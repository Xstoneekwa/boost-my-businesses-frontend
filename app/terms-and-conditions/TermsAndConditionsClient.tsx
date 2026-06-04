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
      "Instagram Growth — automated social media growth using AI and physical device infrastructure",
      "UGC Ads Engine — AI-generated marketing content and video production workflows",
      "WhatsApp Lead System — automated lead qualification, response, and routing",
      "AI Call Assistant — automated phone call handling for restaurants and local businesses",
      "Personal AI Swarm — multi-agent orchestration for business automation",
      "consulting and custom implementation services",
    ],
  },
  {
    title: "User Responsibilities",
    body: ["You agree to:"],
    list: [
      "provide accurate and complete information",
      "use our services in a lawful manner",
      "not misuse, interfere with, or attempt to disrupt our systems or services",
      "not use our services for fraudulent, abusive, or unauthorised purposes",
      "comply with the terms of service of any third-party platforms connected through our services (including Instagram/Meta)",
    ],
  },
  {
    title: "Subscriptions, Billing, and Automatic Renewal",
    body: [
      "Payments are processed securely through Paddle (paddle.com), our authorised reseller and Merchant of Record.",
      "By purchasing a subscription, you authorise recurring billing at the frequency selected at checkout — monthly, quarterly (3 months), semi-annual (6 months), or annual (12 months).",
      "Subscriptions renew automatically at the end of each billing period. You will be charged the same amount unless you cancel in advance.",
      "To cancel, email growth@boostmybusinesses.com at least 7 days before your next renewal date. Include your name, email address, and the plan you wish to cancel.",
      "Upon cancellation, your access continues until the end of the current paid period. No partial refunds are issued for unused time within an active billing period.",
      "For multi-month plans (3, 6, or 12 months), the same notice applies: email us at least 7 days before the scheduled renewal date to prevent the next charge.",
    ],
  },
  {
    title: "Third-Party Platforms",
    body: [
      "Our Instagram Growth service operates in connection with the Instagram platform, owned by Meta Platforms Inc. Use of this service is also subject to Instagram's Terms of Use and Community Guidelines.",
      "BoostMyBusinesses is not affiliated with, endorsed by, or sponsored by Meta or Instagram.",
      "You are responsible for ensuring that your use of our service complies with Instagram's terms and any applicable laws in your jurisdiction.",
      "BoostMyBusinesses does not accept liability for any restriction, suspension, or termination of your Instagram account by Meta.",
    ],
  },
  {
    title: "No Guarantee of Results",
    body: [
      "We do not guarantee specific business outcomes, including but not limited to revenue growth, number of leads, bookings, conversions, follower counts, or sales. Results depend on many factors outside our control.",
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
      intro="These Terms of Service govern your access to and use of the website and all services operated by Dibu Business Trading (trading as BoostMyBusinesses), including Instagram Growth, UGC Ads Engine, WhatsApp Lead System, AI Call Assistant, and other digital products. By using our website or purchasing our services, you agree to these terms. Effective date: 2 June 2026."
      sections={sections}
    />
  );
}
