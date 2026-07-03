#!/usr/bin/env node
import {
  applyStripePublicCatalog,
  buildStripeCatalogProvisionerPlan,
  redactProvisionerReport,
} from "../lib/commercial/stripe/stripe-catalog-provisioner.ts";
import { createStripeClient } from "../lib/commercial/stripe/stripe-client.ts";
import { requireStripeTestConfig, StripeFoundationError } from "../lib/commercial/stripe/stripe-config.ts";

const args = new Set(process.argv.slice(2));
const environment = args.has("--live") ? "live" : "test";
const mode = args.has("--apply") ? "apply" : "dry_run";

if (mode !== "dry_run" && !args.has("--i-understand-this-creates-stripe-objects")) {
  console.error("Refusing apply mode without explicit safety flag.");
  process.exit(2);
}

const plan = buildStripeCatalogProvisionerPlan({ environment, mode });
if ("ok" in plan && plan.ok === false) {
  console.error(JSON.stringify({ ok: false, code: plan.code }));
  process.exit(2);
}

if (mode === "dry_run") {
  console.log(JSON.stringify({ ok: true, ...redactProvisionerReport(plan) }, null, 2));
} else {
  if (environment !== "test") {
    console.error(JSON.stringify({ ok: false, code: "stripe_test_environment_required" }));
    process.exit(2);
  }
  let config;
  try {
    config = requireStripeTestConfig();
  } catch (error) {
    const code = error instanceof StripeFoundationError ? error.code : "stripe_test_not_configured";
    console.error(JSON.stringify({ ok: false, code }));
    process.exit(2);
  }
  const result = await applyStripePublicCatalog({
    environment: "test",
    mode: "apply",
    secretKey: config.secretKey,
    client: createStripeClient(config),
  });
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, code: result.code }));
    process.exit(2);
  }
  console.log(JSON.stringify(result, null, 2));
}
