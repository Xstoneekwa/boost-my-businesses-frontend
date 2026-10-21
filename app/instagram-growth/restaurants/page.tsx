import { marketingMetadata } from "@/lib/marketing/seo";
import MarketingStructuredData from "@/app/components/MarketingStructuredData";
import { VerticalGrowthPage } from "../../components/GrowthLandingPages";

export const metadata = marketingMetadata("/instagram-growth/restaurants");

export default function RestaurantsInstagramGrowthPage() {
  return <><MarketingStructuredData path="/instagram-growth/restaurants" /><VerticalGrowthPage vertical="restaurants" /></>;
}
