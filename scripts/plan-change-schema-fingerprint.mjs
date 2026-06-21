/**
 * Expected schema fingerprint parsed from repo migrations (read-only reference).
 * Used by validate-plan-change-db-integration.mjs --phase=environment
 */

export const MIGRATION_VERSIONS = {
  checkout: "20260615143000_commercial_checkout_entitlements.sql",
  planChange: "20260621120000_commercial_plan_change.sql",
};

export const FINGERPRINT_TABLES = [
  "commercial_checkout_sessions",
  "client_account_entitlements",
  "commercial_checkout_audit_events",
  "commercial_plan_change_quotes",
  "client_credit_ledger",
];

export const REQUIRED_COLUMNS = {
  commercial_checkout_sessions: [
    "id",
    "idempotency_key",
    "flow_type",
    "status",
    "client_id",
    "pack_period_total_cents",
    "total_period_cents",
    "metadata",
    "activated_at",
  ],
  client_account_entitlements: [
    "id",
    "client_id",
    "checkout_session_id",
    "plan_key",
    "pack_period_total_cents",
    "total_period_cents",
    "status",
    "metadata",
  ],
  commercial_checkout_audit_events: [
    "id",
    "checkout_session_id",
    "entitlement_id",
    "event_type",
    "client_id",
    "payload",
  ],
  commercial_plan_change_quotes: [
    "id",
    "client_id",
    "idempotency_key",
    "source_entitlement_id",
    "source_checkout_session_id",
    "active_commercial_period_value_cents",
    "credit_applied_cents",
    "amount_due_cents",
    "remaining_credit_cents",
    "payment_provider",
    "payment_status",
    "provider_transaction_id",
    "payment_confirmed_at",
    "source_revision",
    "status",
    "quote_expires_at",
  ],
  client_credit_ledger: [
    "id",
    "client_id",
    "entry_type",
    "direction",
    "amount_cents",
    "balance_after_cents",
    "source_quote_id",
    "idempotency_key",
  ],
};

export const FLOW_TYPE_MUST_INCLUDE = "plan_change";

export const RPC_EXPECTED = {
  name: "activate_commercial_plan_change",
  args: ["p_quote_id", "p_idempotency_key", "p_actor_email", "p_simulated_activation"],
  securityDefiner: true,
  searchPath: "public",
};
