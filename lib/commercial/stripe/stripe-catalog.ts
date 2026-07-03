import type { OutreachAddonKey, PlanKey } from "../catalog.ts";

export type StripeCatalogEnvironment = "test" | "live";

export type StripePriceCatalogRow = {
  id: string;
  environment: StripeCatalogEnvironment;
  plan_key: PlanKey;
  billing_interval_months: 1 | 3 | 6 | 12;
  outreach_addon_key: "none" | OutreachAddonKey;
  stripe_product_id: string;
  stripe_price_id: string;
  active: boolean;
};

export function normalizeOutreachCatalogKey(outreachAddonKey: string | null | undefined): "none" | OutreachAddonKey {
  if (outreachAddonKey === "outreach_standard" || outreachAddonKey === "outreach_ai") {
    return outreachAddonKey;
  }
  return "none";
}

export function isValidStripeProductId(value: string) {
  return /^prod_[A-Za-z0-9]+$/.test(value.trim());
}

export function isValidStripePriceId(value: string) {
  return /^price_[A-Za-z0-9]+$/.test(value.trim());
}

export function buildStripeCatalogLookupKey(input: {
  planKey: PlanKey;
  billingIntervalMonths: 1 | 3 | 6 | 12;
  outreachAddonKey?: string | null;
}) {
  return {
    plan_key: input.planKey,
    billing_interval_months: input.billingIntervalMonths,
    outreach_addon_key: normalizeOutreachCatalogKey(input.outreachAddonKey),
  };
}

export function resolveStripePriceIdFromCatalogRow(row: StripePriceCatalogRow | null | undefined) {
  if (!row?.active || !isValidStripePriceId(row.stripe_price_id)) {
    return null;
  }
  return row.stripe_price_id;
}

export function buildSafeStripeMetadata(input: Record<string, string | null | undefined>) {
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) {
      metadata[key] = trimmed.slice(0, 500);
    }
  }
  return metadata;
}

const FORBIDDEN_METADATA_KEYS = new Set([
  "password",
  "password_confirmation",
  "token",
  "secret",
  "session",
  "authorization",
  "webhook_secret",
]);

export function rejectUnsafeStripeMetadataKeys(metadata: Record<string, string>) {
  for (const key of Object.keys(metadata)) {
    const normalized = key.trim().toLowerCase();
    if (FORBIDDEN_METADATA_KEYS.has(normalized)) {
      throw new Error("unsafe_stripe_metadata_key");
    }
    if (normalized.includes("password") || normalized.includes("secret") || normalized.includes("token")) {
      throw new Error("unsafe_stripe_metadata_key");
    }
  }
}
