import type { Metadata } from "next";
import { InstagramGrowthFrame } from "./InstagramGrowthFrame";

export const metadata: Metadata = {
  title: "Instagram Growth – Boost My Businesses",
  description: "Croissance Instagram automatisée par IA. Abonnés réels, géolocalisés, sans engagement.",
};

export default function InstagramGrowthPage() {
  return <InstagramGrowthFrame />;
}
