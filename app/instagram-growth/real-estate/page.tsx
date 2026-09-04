import type { Metadata } from "next";
import { VerticalGrowthPage } from "../../components/GrowthLandingPages";

export const metadata: Metadata = {
  title: "Instagram Growth for Real Estate | Boost My Businesses",
  description: "Managed Instagram audience growth for real-estate agents, agencies, developers and property businesses.",
};

export default function RealEstateInstagramGrowthPage() {
  return <VerticalGrowthPage vertical="real-estate" />;
}
