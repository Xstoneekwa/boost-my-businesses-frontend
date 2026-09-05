import { marketingMetadata } from "@/lib/marketing/seo";
import MarketingStructuredData from "@/app/components/MarketingStructuredData";
import { HomeMarketingPage } from "./components/MarketingPages";

export const metadata = marketingMetadata("/");

export default function HomePage() {
  return <><MarketingStructuredData path="/" /><HomeMarketingPage /></>;
}
