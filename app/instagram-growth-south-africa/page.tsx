import { marketingMetadata } from "@/lib/marketing/seo";
import MarketingStructuredData from "@/app/components/MarketingStructuredData";
import { SouthAfricaGrowthPage } from "../components/GrowthLandingPages";

export const metadata = marketingMetadata("/instagram-growth-south-africa");

export default function InstagramGrowthSouthAfricaPage() {
  return <><MarketingStructuredData path="/instagram-growth-south-africa" /><SouthAfricaGrowthPage /></>;
}
