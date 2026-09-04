import type { Metadata } from "next";
import { HomeMarketingPage } from "./components/MarketingPages";

export const metadata: Metadata = {
  title: "Instagram Growth & AI Automation | Boost My Businesses",
  description: "Managed, AI-powered Instagram growth from real phones, with complementary automation systems for calls, leads, support and content.",
};

export default function HomePage() {
  return <HomeMarketingPage />;
}
