import { marketingMetadata } from "@/lib/marketing/seo";
import MarketingStructuredData from "@/app/components/MarketingStructuredData";
import { InstagramGrowthFrame } from "./InstagramGrowthFrame";

export const metadata = marketingMetadata("/instagram-growth");

export default function InstagramGrowthPage() {
  return <><MarketingStructuredData path="/instagram-growth" /><InstagramGrowthFrame /></>;
}
