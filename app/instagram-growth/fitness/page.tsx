import type { Metadata } from "next";
import { VerticalGrowthPage } from "../../components/GrowthLandingPages";

export const metadata: Metadata = {
  title: "Instagram Growth for Fitness Brands | Boost My Businesses",
  description: "Managed Instagram growth for gyms, trainers, run clubs, coaches and fitness communities.",
};

export default function FitnessInstagramGrowthPage() {
  return <VerticalGrowthPage vertical="fitness" />;
}
