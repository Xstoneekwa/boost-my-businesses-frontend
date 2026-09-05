import { marketingStructuredData, type MarketingPath } from "@/lib/marketing/seo";
import MarketingAnalytics from "./MarketingAnalytics";

export default function MarketingStructuredData({ path }: { path: MarketingPath }) {
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(marketingStructuredData(path)).replace(/</g, "\\u003c") }} /><MarketingAnalytics path={path} /></>;
}
