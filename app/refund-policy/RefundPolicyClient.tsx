import LegalPageShell, { type LegalSection } from "../components/LegalPageShell";

const sections: LegalSection[] = [
  {
    title: "Overview",
    body: [
      "Because our services are digital, service-based, customized, or implementation-related, all sales are generally considered final unless otherwise stated in writing.",
    ],
  },
  {
    title: "Subscription Services",
    body: [
      "If you purchase a subscription, you may cancel at any time before the next billing cycle.",
      "Cancellation prevents future charges but does not automatically refund payments already made.",
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
    title: "How to Request a Refund",
    body: ["To request a refund, please contact:"],
    bodyAfterContact: ["Please include:"],
    contact: "growth@boostmybusinesses.com",
    contactPlacement: "beforeList",
    list: [
      "your full name",
      "your email address",
      "purchase details",
      "reason for the request",
    ],
  },
  {
    title: "Processing Time",
    body: [
      "If a refund is approved, it will generally be processed within 5 to 10 business days, depending on the payment provider.",
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
      intro="This Refund Policy explains how refund requests are handled for services and digital solutions provided by BoostMyBusinesses."
      sections={sections}
    />
  );
}
