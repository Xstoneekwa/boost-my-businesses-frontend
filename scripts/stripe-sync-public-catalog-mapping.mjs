#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import {
  syncStripePublicCatalogMapping,
} from "../lib/commercial/stripe/stripe-catalog-provisioner.ts";
import { createStripeClient } from "../lib/commercial/stripe/stripe-client.ts";
import {
  isStripeLiveSecretKey,
  isStripeTestSecretKey,
} from "../lib/commercial/stripe/stripe-config.ts";

const PRODUCTION_REF = "zgafnshkjywfltxgbtzg";
const FORBIDDEN_TEST_REF = "nxntngkhkoynljcagmkq";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");

if (apply && !args.has("--i-understand-this-writes-production-mapping")) {
  console.error(JSON.stringify({ ok: false, code: "mapping_apply_confirmation_required" }));
  process.exit(2);
}

try {
  const stripeSecretKey = readStripeTestKey();
  const supabase = createProductionSupabaseClient();
  const result = await syncStripePublicCatalogMapping({
    environment: "test",
    secretKey: stripeSecretKey,
    client: createStripeClient({
      secretKey: stripeSecretKey,
      webhookSecret: null,
      billingPortalConfigurationId: null,
      testCheckoutEnabled: true,
    }),
    store: new SupabaseMappingStore(supabase),
    dryRun: !apply,
  });

  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, code: result.code }));
    process.exit(2);
  }

  console.log(JSON.stringify({
    ok: true,
    environment: result.environment,
    mode: apply ? "apply" : "dry_run",
    productCount: result.productCount,
    priceCount: result.priceCount,
    mappingsCreated: result.mappingsCreated,
    mappingsReconciled: result.mappingsReconciled,
    livemodeFalse: result.livemodeFalse,
    productNames: result.productNames,
    states: result.states,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error instanceof SafeMappingError ? error.code : "stripe_catalog_mapping_sync_failed",
  }));
  process.exit(2);
}

function readStripeTestKey() {
  const key = String(process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) throw new SafeMappingError("stripe_test_key_required");
  if (isStripeLiveSecretKey(key)) throw new SafeMappingError("stripe_live_key_rejected");
  if (!isStripeTestSecretKey(key)) throw new SafeMappingError("stripe_test_mode_required");
  return key;
}

function createProductionSupabaseClient() {
  const supabaseUrl = String(process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) throw new SafeMappingError("supabase_production_config_required");
  const ref = extractSupabaseProjectRefFromUrl(supabaseUrl);
  if (ref === FORBIDDEN_TEST_REF) throw new SafeMappingError("forbidden_supabase_project_ref");
  if (ref !== PRODUCTION_REF) throw new SafeMappingError("production_supabase_ref_required");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function extractSupabaseProjectRefFromUrl(url) {
  return url.match(/^https?:\/\/([^.]+)\./i)?.[1]?.toLowerCase() ?? null;
}

class SupabaseMappingStore {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async listMappings(environment) {
    const { data, error } = await this.supabase
      .from("commercial_stripe_component_price_catalog")
      .select([
        "environment",
        "product_key",
        "component_kind",
        "package_key",
        "outreach_key",
        "billing_interval_months",
        "stripe_product_id",
        "stripe_price_id",
        "expected_amount_cents",
        "currency",
        "active",
        "catalog_version",
        "fingerprint",
        "metadata_safe",
      ].join(","))
      .eq("environment", environment)
      .eq("active", true);
    if (error) throw new SafeMappingError("mapping_store_read_failed");
    return data ?? [];
  }

  async upsertMappings(rows) {
    if (rows.length === 0) return;
    const { error } = await this.supabase
      .from("commercial_stripe_component_price_catalog")
      .upsert(rows, {
        onConflict: "environment,product_key,component_kind,billing_interval_months,expected_amount_cents,currency",
      });
    if (error) throw new SafeMappingError("mapping_store_write_failed");
  }
}

class SafeMappingError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
