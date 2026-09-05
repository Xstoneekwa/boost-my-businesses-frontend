import { marketingMetadata } from "@/lib/marketing/seo";
import MarketingStructuredData from "@/app/components/MarketingStructuredData";
import { AiAutomationMarketingPage } from "../components/MarketingPages";

export const metadata = marketingMetadata("/ai-automation");

export default function AiAutomationPage() {
  return <><MarketingStructuredData path="/ai-automation" /><AiAutomationMarketingPage /></>;
}
