import type { Metadata } from "next";
import { VerticalGrowthPage } from "../../components/GrowthLandingPages";

export const metadata: Metadata = {
  title: "Instagram Growth for Beauty & Aesthetics | Boost My Businesses",
  description: "Managed Instagram growth for salons, skincare, aesthetics, bridal and wellness businesses seeking relevant local audiences.",
};

export default function BeautyAestheticsInstagramGrowthPage() {
  return <VerticalGrowthPage vertical="beauty-aesthetics" />;
}
