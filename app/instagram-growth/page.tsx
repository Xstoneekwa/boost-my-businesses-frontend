import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Instagram Growth – Boost My Businesses",
  description: "Croissance Instagram automatisée par IA. Abonnés réels, géolocalisés, sans engagement.",
};

export default function InstagramGrowthPage() {
  return (
    <iframe
      src="/instagram-growth/index.html"
      title="Instagram Growth – BoostMyBusinesses"
      style={{
        display: "block",
        width: "100%",
        height: "100dvh",
        border: "none",
      }}
    />
  );
}
