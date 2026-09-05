"use client";

import { useEffect } from "react";
import { startMarketingTracking } from "@/lib/marketing/tracking";
import { GTM_ENABLED } from "@/lib/marketing/gtm";

export default function MarketingAnalytics({ path }: { path: string }) {
  useEffect(() => startMarketingTracking(path, {
    enabled: GTM_ENABLED,
  }), [path]);
  return null;
}
