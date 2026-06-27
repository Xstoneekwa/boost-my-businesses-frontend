import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSql = readFileSync(
  new URL("../../supabase/migrations/20260703120000_client_email_dispatch_claim_state.sql", import.meta.url),
  "utf8",
);

const contractDoc = readFileSync(
  new URL("../../docs/client-email-materialize-dispatch-contract.md", import.meta.url),
  "utf8",
);

const LEGACY_STATUSES = ["pending", "scheduled", "sent", "canceled", "failed"] as const;
const NEW_STATUSES = ["claimed", "dispatch_uncertain"] as const;

test("migration preserves existing intent statuses", () => {
  for (const status of LEGACY_STATUSES) {
    assert.match(migrationSql, new RegExp(`'${status}'`));
  }
});

test("migration adds dispatch claim statuses", () => {
  for (const status of NEW_STATUSES) {
    assert.match(migrationSql, new RegExp(`'${status}'`));
  }
});

test("historical sent test intents remain valid shape", () => {
  assert.doesNotMatch(migrationSql, /update public\.client_email_send_intents/i);
  assert.match(migrationSql, /intent_kind=test, status=sent/i);
  assert.match(migrationSql, /null claim fields/i);
});

test("claimed state requires lease token and timestamps", () => {
  assert.match(migrationSql, /client_email_send_intents_claimed_state_requires_lease/);
  assert.match(migrationSql, /claim_token is not null/);
  assert.match(migrationSql, /claim_expires_at > claimed_at/);
});

test("dispatch_uncertain is terminal for automatic pending retry", () => {
  assert.match(migrationSql, /client_email_send_intents_uncertain_state_requires_timestamp/);
  assert.match(migrationSql, /client_email_send_intents_uncertain_has_no_provider_message/);
  assert.match(migrationSql, /client_email_send_intents_dispatch_uncertain_idx/);
  assert.match(
    migrationSql,
    /status in \('pending', 'scheduled'\)/,
    "pending dispatch index must not include dispatch_uncertain",
  );
  assert.match(contractDoc, /dispatch_uncertain.*\*\*never\*\*/s);
  assert.match(contractDoc, /aucun retour automatique|never.*forbidden/is);
});

test("provider_message_id is not re-added and gets unique partial index", () => {
  assert.match(migrationSql, /provider_message_id already exists/i);
  assert.doesNotMatch(migrationSql, /add column if not exists provider_message_id/i);
  assert.match(migrationSql, /client_email_send_intents_provider_message_id_idx/);
});

test("claim and uncertain indexes are present", () => {
  assert.match(migrationSql, /client_email_send_intents_dispatch_pending_idx/);
  assert.match(migrationSql, /client_email_send_intents_dispatch_claimed_idx/);
  assert.match(migrationSql, /client_email_send_intents_dispatch_uncertain_idx/);
  assert.match(migrationSql, /client_email_send_intents_sequence_status_idx/);
  assert.match(migrationSql, /client_email_send_intents_lifecycle_episode_status_idx/);
});

test("migration creates no rpc trigger cron queue or worker", () => {
  assert.doesNotMatch(migrationSql, /create\s+(or\s+replace\s+)?function/i);
  assert.doesNotMatch(migrationSql, /create\s+trigger/i);
  assert.doesNotMatch(migrationSql, /pg_cron/i);
  assert.doesNotMatch(migrationSql, /cron\.schedule/i);
});

test("contract doc documents dispatch state transitions", () => {
  assert.match(contractDoc, /pending.*claimed/s);
  assert.match(contractDoc, /dispatch_uncertain/);
  assert.match(contractDoc, /20260703120000_client_email_dispatch_claim_state\.sql/);
});

test("no writer route or provider call introduced in migration tests scope", () => {
  assert.doesNotMatch(migrationSql, /postmark/i);
  assert.doesNotMatch(migrationSql, /insert into public\.client_email_send_intents/i);
});
