/**
 * Shared contract for Plan Change test harness and environment classification.
 * No secrets. No DB access.
 */

export const ALLOWED_TARGET_REF = "nxntngkhkoynljcagmkq";
export const FORBIDDEN_REFS = ["zgafnshkjywfltxgbtzg"];

export const INVENTORY_TABLES = [
  "clients",
  "ig_accounts",
  "tenant_users",
  "client_users",
  "client_subscriptions",
  "client_instagram_accounts",
  "commercial_checkout_sessions",
  "client_account_entitlements",
  "commercial_checkout_audit_events",
  "commercial_plan_change_quotes",
  "client_credit_ledger",
];

export const CHECKOUT_TABLES = [
  "commercial_checkout_sessions",
  "client_account_entitlements",
  "commercial_checkout_audit_events",
];

export const PLAN_CHANGE_TABLES = ["commercial_plan_change_quotes", "client_credit_ledger"];

export const CLASSIFICATION = {
  A: "schema_exact_present",
  B: "schema_partial_or_divergent",
  C: "probe_or_access_inconclusive",
  D: "empty_baseline_test_database",
};

/**
 * @param {object} input
 * @param {Record<string, { state?: string }>} input.inventory
 * @param {{ isolationInconclusive?: boolean, isolationFailed?: boolean }} input.isolation
 * @param {{ diffs?: unknown[] }} input.fingerprint
 * @param {string} input.ref
 */
export function classifyEnvironmentState({ inventory, isolation, fingerprint, ref }) {
  const states = INVENTORY_TABLES.map((table) => inventory[table]?.state ?? "unknown");
  const anyExists = states.some((state) => state === "exists");
  const anyInaccessible = states.some((state) => state === "inaccessible");
  const allMissing = states.every((state) => state === "missing");

  const checkoutExists = CHECKOUT_TABLES.some((t) => inventory[t]?.state === "exists");
  const checkoutAllMissing = CHECKOUT_TABLES.every((t) => inventory[t]?.state === "missing");
  const planChangeExists = PLAN_CHANGE_TABLES.some((t) => inventory[t]?.state === "exists");
  const planChangeAllExist = PLAN_CHANGE_TABLES.every((t) => inventory[t]?.state === "exists");
  const checkoutAllExist = CHECKOUT_TABLES.every((t) => inventory[t]?.state === "exists");

  if (ref === ALLOWED_TARGET_REF && allMissing && !anyExists && !anyInaccessible && !isolation?.isolationFailed) {
    return CLASSIFICATION.D;
  }

  if (anyInaccessible || isolation?.isolationFailed) {
    return CLASSIFICATION.C;
  }

  if (checkoutAllExist && planChangeAllExist && isolation?.isolationPass && (fingerprint?.diffs?.length ?? 0) === 0) {
    return CLASSIFICATION.A;
  }

  if (anyExists || (checkoutExists && !checkoutAllExist) || (planChangeExists && !planChangeAllExist)) {
    return CLASSIFICATION.B;
  }

  if (isolation?.isolationInconclusive) {
    return CLASSIFICATION.C;
  }

  if (checkoutAllMissing && !planChangeExists && ref === ALLOWED_TARGET_REF) {
    return CLASSIFICATION.D;
  }

  return CLASSIFICATION.C;
}

export function classificationLabel(code) {
  switch (code) {
    case CLASSIFICATION.A:
      return "A — schema_exact_present";
    case CLASSIFICATION.B:
      return "B — schema_partial_or_divergent";
    case CLASSIFICATION.C:
      return "C — probe_or_access_inconclusive";
    case CLASSIFICATION.D:
      return "D — empty_baseline_test_database";
    default:
      return `unknown (${code})`;
  }
}
