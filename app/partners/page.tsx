import type { Metadata } from "next";
import PartnersPage from "./PartnersPage";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.boostmybusinesses.com"),
  title: "Instagram Growth for Agencies & Resellers | BMB Partners",
  description: "Add managed Instagram Growth to your agency. Keep your client relationship while BMB handles targeting, real-phone infrastructure and multi-account operations.",
  alternates: { canonical: "https://www.boostmybusinesses.com/partners" },
  openGraph: {
    title: "Your agency. Powered by BMB.",
    description: "Instagram Growth infrastructure for agencies and resellers.",
    url: "https://www.boostmybusinesses.com/partners",
    images: [{ url: "/partners/assets/agency-operations-v1.jpg", width: 1672, height: 941 }],
  },
};

export default function Page() { return <PartnersPage />; }
