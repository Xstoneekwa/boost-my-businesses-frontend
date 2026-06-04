import LegalPageShell, { type LegalSection } from "../components/LegalPageShell";

const sections: LegalSection[] = [
  {
    title: "Overview",
    body: [
      "Because our services are digital, service-based, customised, or implementation-related, all sales are generally considered final unless otherwise stated in writing.",
    ],
  },
  {
    title: "Subscription Services",
    body: [
      "If you purchase a subscription (including Instagram Growth, UGC Ads Engine, or WhatsApp Lead System plans), the following terms apply.",
      "Subscriptions renew automatically at the end of each billing period. To prevent automatic renewal and avoid the next charge, you must cancel by emailing growth@boostmybusinesses.com at least 7 days before your renewal date.",
      "Upon cancellation, your access continues until the end of the current paid period. No partial refunds are issued for the remaining unused time in the current billing period.",
      "For multi-month plans (3, 6, or 12 months), the same notice period applies: email us at least 7 days before the scheduled renewal date.",
    ],
  },
  {
    title: "One-Time Services",
    body: [
      "For one-time services, strategy work, setup work, implementation work, consulting, or custom digital services, refunds are generally not provided once work has started or service delivery has begun.",
    ],
  },
  {
    title: "Exceptional Refund Cases",
    body: ["A refund may be considered in exceptional situations, such as:"],
    list: [
      "duplicate payment",
      "clear billing error",
      "service not delivered due to an issue solely caused by us",
    ],
    bodyAfterList: ["Any refund request is reviewed on a case-by-case basis."],
  },
  {
    title: "How to Request a Refund or Cancellation",
    body: ["To request a refund or cancel your subscription, please contact:"],
    bodyAfterContact: ["Please include:"],
    contact: "growth@boostmybusinesses.com",
    contactPlacement: "beforeList",
    list: [
      "your full name",
      "your email address",
      "the plan or service concerned",
      "reason for the request",
    ],
  },
  {
    title: "Processing Time",
    body: [
      "If a refund is approved, it will generally be processed within 5 to 10 business days, depending on the payment provider (Paddle).",
    ],
  },
  {
    title: "Contact",
    body: ["For any questions regarding this Refund Policy, please contact:"],
    contact: "growth@boostmybusinesses.com",
  },
];

export default function RefundPolicyClient() {
  return (
    <LegalPageShell
      title="Refund Policy"
      intro="This Refund Policy explains how refund and cancellation requests are handled for services and digital solutions provided by Dibu Business Trading (trading as BoostMyBusinesses) — including Instagram Growth, UGC Ads Engine, WhatsApp Lead System, AI Call Assistant, and other subscription or one-time services. Effective date: 2 June 2026."
      sections={sections}
    />
  );
}
