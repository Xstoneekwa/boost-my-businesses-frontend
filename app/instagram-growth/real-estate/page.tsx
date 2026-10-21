import { marketingMetadata } from "@/lib/marketing/seo";
import MarketingStructuredData from "@/app/components/MarketingStructuredData";
import { VerticalGrowthPage } from "../../components/GrowthLandingPages";

export const metadata = marketingMetadata("/instagram-growth/real-estate");

export default function RealEstateInstagramGrowthPage() {
  return <><MarketingStructuredData path="/instagram-growth/real-estate" /><VerticalGrowthPage vertical="real-estate" /></>;
}
