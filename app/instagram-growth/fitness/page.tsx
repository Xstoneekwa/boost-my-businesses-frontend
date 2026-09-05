import { marketingMetadata } from "@/lib/marketing/seo";
import MarketingStructuredData from "@/app/components/MarketingStructuredData";
import { VerticalGrowthPage } from "../../components/GrowthLandingPages";

export const metadata = marketingMetadata("/instagram-growth/fitness");

export default function FitnessInstagramGrowthPage() {
  return <><MarketingStructuredData path="/instagram-growth/fitness" /><VerticalGrowthPage vertical="fitness" /></>;
}
