#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  SafeCatalogMappingError,
  safeCatalogMappingFailurePayload,
  syncStripePublicCatalogMapping,
} from "../lib/commercial/stripe/stripe-catalog-provisioner.ts";
import { createStripeClient } from "../lib/commercial/stripe/stripe-client.ts";
import {
  isStripeLiveSecretKey,
  isStripeTestSecretKey,
} from "../lib/commercial/stripe/stripe-config.ts";

const PRODUCTION_REF = "zgafnshkjywfltxgbtzg";
const FORBIDDEN_TEST_REF = "nxntngkhkoynljcagmkq";

export async function runStripeCatalogMappingCli(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const syncMapping = options.syncStripePublicCatalogMapping ?? syncStripePublicCatalogMapping;
  const makeStripeClient = options.createStripeClient ?? createStripeClient;
  const makeSupabaseClient = options.createSupabaseClient ?? createClient;
  const makeMappingStore = options.createMappingStore ?? ((supabase) => new SupabaseMappingStore(supabase));
  const writeDiagnosticFile = options.writeDiagnosticFile ?? writeRedactedDiagnosticFile;
  const now = options.now ?? (() => new Date());
  const args = new Set(argv);
  const apply = args.has("--apply");
  const mode = apply ? "apply" : "dry_run";
  let activeCheckpoint = "cli_preflight";
  const setActiveCheckpoint = (checkpoint) => {
    if (ALLOWED_RUNTIME_CHECKPOINTS.has(checkpoint)) {
      activeCheckpoint = checkpoint;
    }
  };

  if (apply && !args.has("--i-understand-this-writes-production-mapping")) {
    const failure = {
      ok: false,
      code: "mapping_apply_confirmation_required",
      stage: "validation",
      checkpoint: "cli_preflight",
    };
    await maybeWriteDiagnosticFile({
      env,
      failure,
      mode,
      errorClass: "safe_failure",
      now,
      writeDiagnosticFile,
    });
    stderr(JSON.stringify(failure));
    return 2;
  }
  try {
    setActiveCheckpoint("cli_preflight");
    const stripeSecretKey = readStripeTestKey(env);
    const supabase = createProductionSupabaseClient(env, makeSupabaseClient);
    setActiveCheckpoint("stripe_client_init");
    let stripeClient;
    try {
      stripeClient = makeStripeClient({
        secretKey: stripeSecretKey,
        webhookSecret: null,
        billingPortalConfigurationId: null,
        testCheckoutEnabled: true,
      });
    } catch (error) {
      if (isUnexpectedRuntimeError(error)) throw error;
      throw new SafeCatalogMappingError({
        code: "stripe_catalog_validation_failed",
        stage: "validation",
        checkpoint: "stripe_client_init",
      });
    }
    setActiveCheckpoint("mapping_store_init");
    const mappingStore = makeMappingStore(supabase);
    const result = await syncMapping({
      environment: "test",
      secretKey: stripeSecretKey,
      client: stripeClient,
      store: mappingStore,
      dryRun: !apply,
      buildPlanForTests: options.buildPlanForTests,
      onCheckpoint: setActiveCheckpoint,
    });

    if (!result.ok) {
      const failure = safeCliFailurePayload(result);
      await maybeWriteDiagnosticFile({
        env,
        failure,
        mode,
        errorClass: result.error_class ?? "safe_failure",
        now,
        writeDiagnosticFile,
      });
      stderr(JSON.stringify(failure));
      return 2;
    }

    stdout(JSON.stringify({
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
    return 0;
  } catch (error) {
    const failure = safeCliFailurePayload(safeCatalogMappingFailurePayload(error, {
      code: "unexpected_sync_failure",
      stage: "validation",
      checkpoint: activeCheckpoint,
    }));
    await maybeWriteDiagnosticFile({
      env,
      failure,
      mode,
      errorClass: safeErrorClass(error),
      now,
      writeDiagnosticFile,
    });
    stderr(JSON.stringify(failure));
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runStripeCatalogMappingCli();
}

function readStripeTestKey(env) {
  const key = String(env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) throw new SafeCatalogMappingError({ code: "stripe_test_key_required", stage: "validation", checkpoint: "cli_preflight" });
  if (isStripeLiveSecretKey(key)) throw new SafeCatalogMappingError({ code: "stripe_live_key_rejected", stage: "validation", checkpoint: "cli_preflight" });
  if (!isStripeTestSecretKey(key)) throw new SafeCatalogMappingError({ code: "stripe_test_mode_required", stage: "validation", checkpoint: "cli_preflight" });
  return key;
}

function createProductionSupabaseClient(env, makeSupabaseClient) {
  const supabaseUrl = String(env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new SafeCatalogMappingError({ code: "supabase_production_config_required", stage: "validation", checkpoint: "cli_preflight" });
  }
  const ref = extractSupabaseProjectRefFromUrl(supabaseUrl);
  if (ref === FORBIDDEN_TEST_REF) {
    throw new SafeCatalogMappingError({ code: "forbidden_supabase_project_ref", stage: "validation", checkpoint: "cli_preflight" });
  }
  if (ref !== PRODUCTION_REF) {
    throw new SafeCatalogMappingError({ code: "production_supabase_ref_required", stage: "validation", checkpoint: "cli_preflight" });
  }
  return makeSupabaseClient(supabaseUrl, serviceRoleKey, {
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
    if (error) throw safeSupabaseError(error, {
      code: "production_mapping_read_failed",
      stage: "mapping_read",
      checkpoint: "mapping_store_read",
      schemaOrRlsCode: "production_mapping_schema_or_rls_failed",
    });
    return data ?? [];
  }

  async upsertMappings(rows) {
    if (rows.length === 0) return;
    const { error } = await this.supabase
      .from("commercial_stripe_component_price_catalog")
      .upsert(rows, {
        onConflict: "environment,product_key,component_kind,billing_interval_months,expected_amount_cents,currency",
      });
    if (error) throw safeSupabaseError(error, {
      code: "production_mapping_write_failed",
      stage: "mapping_write",
      checkpoint: "mapping_store_write",
    });
  }
}

function safeCliFailurePayload(failure) {
  return Object.fromEntries(
    Object.entries({
      ok: false,
      code: failure.code,
      stage: failure.stage,
      checkpoint: failure.checkpoint,
      provider_status: failure.provider_status,
      provider_code: failure.provider_code,
    }).filter(([, value]) => value !== undefined),
  );
}

async function maybeWriteDiagnosticFile(input) {
  const path = String(input.env.STRIPE_MAPPING_DIAGNOSTIC_FILE ?? "").trim();
  if (!path) return;
  const diagnostic = safeDiagnosticPayload({
    failure: input.failure,
    mode: input.mode,
    errorClass: input.errorClass,
    timestamp: input.now().toISOString(),
  });
  await input.writeDiagnosticFile(path, diagnostic);
}

function safeDiagnosticPayload(input) {
  return Object.fromEntries(
    Object.entries({
      ok: false,
      code: input.failure.code,
      stage: input.failure.stage,
      checkpoint: input.failure.checkpoint,
      error_class: ALLOWED_ERROR_CLASSES.has(input.errorClass) ? input.errorClass : "unknown",
      provider_status: input.failure.provider_status,
      provider_code: input.failure.provider_code,
      timestamp: input.timestamp,
      mode: input.mode,
    }).filter(([, value]) => value !== undefined),
  );
}

async function writeRedactedDiagnosticFile(path, payload) {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

function safeSupabaseError(error, input) {
  const provider_status = safeProviderStatus(error);
  const provider_code = safeProviderCode(error);
  let code = input.code;
  if (
    input.schemaOrRlsCode
    && (
      provider_status === 401
      || provider_status === 403
      || provider_code === "42501"
      || provider_code === "42P01"
      || provider_code === "42703"
      || provider_code === "PGRST200"
      || provider_code === "PGRST204"
    )
  ) {
    code = input.schemaOrRlsCode;
  }
  return new SafeCatalogMappingError({
    code,
    stage: input.stage,
    checkpoint: input.checkpoint,
    provider_status,
    provider_code,
  });
}

function safeProviderStatus(error) {
  const record = errorRecord(error);
  for (const value of [record.status, record.statusCode]) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) {
      return value;
    }
  }
  return undefined;
}

function safeProviderCode(error) {
  const record = errorRecord(error);
  const value = record.code;
  if (typeof value === "string" && ALLOWED_SUPABASE_PROVIDER_CODES.has(value)) {
    return value;
  }
  return undefined;
}

function errorRecord(value) {
  return value && typeof value === "object" ? value : {};
}

function isUnexpectedRuntimeError(error) {
  return error instanceof TypeError
    || error instanceof ReferenceError
    || error instanceof RangeError;
}

function safeErrorClass(error) {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof SafeCatalogMappingError) return "SafeCatalogMappingError";
  if (error instanceof Error) return "Error";
  return "unknown";
}

const ALLOWED_SUPABASE_PROVIDER_CODES = new Set([
  "42501",
  "42P01",
  "42703",
  "PGRST200",
  "PGRST204",
]);

const ALLOWED_RUNTIME_CHECKPOINTS = new Set([
  "cli_preflight",
  "stripe_client_init",
  "stripe_products_read",
  "stripe_prices_read",
  "manifest_match",
  "price_attributes",
  "mapping_store_init",
  "mapping_store_read",
  "mapping_conflict_check",
  "mapping_store_write",
]);

const ALLOWED_ERROR_CLASSES = new Set([
  "safe_failure",
  "SafeCatalogMappingError",
  "TypeError",
  "ReferenceError",
  "RangeError",
  "Error",
  "unknown",
]);
