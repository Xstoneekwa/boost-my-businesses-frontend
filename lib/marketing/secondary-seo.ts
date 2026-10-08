import type { Metadata } from "next";
import { PUBLIC_ORIGIN } from "./seo";

// Public informational and service pages, separate from the analytics route registry.
export const secondaryPages = {
  "/about": {
    "title": "About Boost My Businesses Ltd | BoostMyBusinesses",
    "description": "Meet Boost My Businesses Ltd and explore our managed Instagram growth and AI automation services for businesses."
  },
  "/contact": {
    "title": "Contact Boost My Businesses Ltd | BoostMyBusinesses",
    "description": "Contact Boost My Businesses about managed Instagram growth, business AI automation, service enquiries and customer support."
  },
  "/privacy-policy": {
    "title": "Privacy Policy | BoostMyBusinesses",
    "description": "Learn how Boost My Businesses handles personal data, website analytics, consent preferences and your privacy rights."
  },
  "/refund-policy": {
    "title": "Refund Policy | BoostMyBusinesses",
    "description": "Read the Boost My Businesses refund policy, including eligibility, cancellations and how to contact us about a refund."
  },
  "/terms-and-conditions": {
    "title": "Terms of Service | BoostMyBusinesses",
    "description": "Review the terms that apply to Boost My Businesses services, subscriptions, payments and your use of our website."
  },
  "/agent/restaurant-call-assistant": {
    "title": "Restaurant AI Call Assistant | Boost My Businesses",
    "description": "Explore an AI call assistant for restaurants that handles enquiries, captures reservation requests and escalates important calls to your team."
  },
  "/agent/whatsapp-lead-system": {
    "title": "WhatsApp AI Lead System | Boost My Businesses",
    "description": "Discover AI-assisted WhatsApp lead capture, qualification, booking links and human handoff workflows for your business."
  },
  "/agent/ugc-ads-engine": {
    "title": "UGC Ads Engine | Boost My Businesses",
    "description": "Explore the BMB UGC Ads Engine for AI-assisted content and advertising creative workflows, with previews and review before approval."
  }
} as const;
export type SecondaryPath = keyof typeof secondaryPages;
export const secondaryPaths = Object.keys(secondaryPages) as SecondaryPath[];

export function secondaryMetadata(path: SecondaryPath): Metadata {
  const { title, description } = secondaryPages[path];
  const url = PUBLIC_ORIGIN + path;
  return {
    title, description, alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { title, description, url, type: "website", siteName: "Boost My Businesses" },
    twitter: { card: "summary", title, description },
  };
}
