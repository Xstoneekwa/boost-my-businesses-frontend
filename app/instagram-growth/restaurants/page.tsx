import type { Metadata } from "next";
import { VerticalGrowthPage } from "../../components/GrowthLandingPages";

export const metadata: Metadata = {
  title: "Instagram Growth for Restaurants | Boost My Businesses",
  description: "Managed Instagram audience growth for restaurants, hospitality venues and local food brands.",
};

export default function RestaurantsInstagramGrowthPage() {
  return <VerticalGrowthPage vertical="restaurants" />;
}
