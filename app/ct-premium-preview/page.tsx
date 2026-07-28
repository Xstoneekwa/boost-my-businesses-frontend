import { notFound } from "next/navigation";
import CtPremiumReviewHarness from "@/components/ct-premium/CtPremiumReviewHarness";

export const dynamic = "force-dynamic";

export default function CtPremiumPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CtPremiumReviewHarness />;
}
