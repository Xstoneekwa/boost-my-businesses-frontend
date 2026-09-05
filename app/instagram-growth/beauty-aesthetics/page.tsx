import { marketingMetadata } from "@/lib/marketing/seo";
import MarketingStructuredData from "@/app/components/MarketingStructuredData";
import { VerticalGrowthPage } from "../../components/GrowthLandingPages";

export const metadata = marketingMetadata("/instagram-growth/beauty-aesthetics");

export default function BeautyAestheticsInstagramGrowthPage() {
  return <><MarketingStructuredData path="/instagram-growth/beauty-aesthetics" /><VerticalGrowthPage vertical="beauty-aesthetics" /></>;
}
