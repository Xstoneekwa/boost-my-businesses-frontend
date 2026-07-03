#!/usr/bin/env node
import {
  buildStripeCatalogProvisionerPlan,
  redactProvisionerReport,
} from "../lib/commercial/stripe/stripe-catalog-provisioner.ts";

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

console.log(JSON.stringify({ ok: true, ...redactProvisionerReport(plan) }, null, 2));

if (mode === "apply") {
  console.error("Apply mode is intentionally not implemented in this wrapper yet.");
  process.exit(2);
}
