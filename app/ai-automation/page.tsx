import type { Metadata } from "next";
import { AiAutomationMarketingPage } from "../components/MarketingPages";

export const metadata: Metadata = {
  title: "AI Automation for Real Business Workflows | Boost My Businesses",
  description: "Explore AI call assistants, WhatsApp lead automation, support automation, UGC production and custom business workflows.",
};

export default function AiAutomationPage() {
  return <AiAutomationMarketingPage />;
}
