import { marketingMetadata } from "@/lib/marketing/seo";
import MarketingStructuredData from "@/app/components/MarketingStructuredData";
import PartnersPage from "./PartnersPage";

export const metadata = marketingMetadata("/partners");

export default function Page() { return <><MarketingStructuredData path="/partners" /><PartnersPage /></>; }
