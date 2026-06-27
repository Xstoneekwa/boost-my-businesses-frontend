import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isIntentMaterializeOperation,
  resolveStrictMaterializeOperation,
} from "./client-email-outbox-materializer.ts";

const migrationSql = readFileSync(
  new URL("../../supabase/migrations/20260706120000_client_email_materialize_atomic_preparent_validation.sql", import.meta.url),
  "utf8",
);

const contractDoc = readFileSync(
  new URL("../../docs/client-email-materialize-dispatch-contract.md", import.meta.url),
  "utf8",
);

const runnerSource = readFileSync(
  new URL("./client-email-materialization-runner.ts", import.meta.url),
  "utf8",
);

const shadowRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-lifecycle/materialization-shadow-preview/route.ts", import.meta.url),
  "utf8",
);

const precedenceSource = readFileSync(
  new URL("./client-email-lifecycle-outbox-precedence.ts", import.meta.url),
  "utf8",
);

test("initial effective candidate maps to create initial intent not open parent only", () => {
  assert.equal(
    resolveStrictMaterializeOperation({
      category: "account_paused",
      decision: "would_create_initial_intent",
      reminderIndex: 0,
      parentId: null,
    }),
    "create_lifecycle_initial_intent",
  );
  assert.equal(
    resolveStrictMaterializeOperation({
      category: "needs_more_target_accounts",
      decision: "would_create_initial_intent",
      reminderIndex: 0,
      parentId: null,
    }),
    "create_needs_more_initial_intent",
  );
});

test("RPC create initial intent performs parent resolution before intent insert in one function", () => {
  const firstParentInsert = Math.min(
    migrationSql.indexOf("insert into public.client_email_lifecycle_episodes"),
    migrationSql.indexOf("insert into public.client_email_needs_more_targets_sequences"),
  );
  const intentInsertPos = migrationSql.indexOf("insert into public.client_email_send_intents");
  const recipientValidationPos = migrationSql.indexOf("client_email_missing_recipient_email");
  assert.ok(firstParentInsert >= 0);
  assert.ok(intentInsertPos > firstParentInsert);
  assert.ok(recipientValidationPos >= 0 && recipientValidationPos < firstParentInsert);
  assert.match(migrationSql, /create_lifecycle_initial_intent/);
  assert.match(migrationSql, /create_needs_more_initial_intent/);
});

test("open parent operations return before intent insert and are separate from create initial", () => {
  const openReturnPos = migrationSql.indexOf("if p_operation in ('open_lifecycle_episode', 'open_needs_more_sequence')");
  const intentInsertPos = migrationSql.indexOf("insert into public.client_email_send_intents");
  assert.ok(openReturnPos > 0 && openReturnPos < intentInsertPos);
  assert.match(migrationSql, /'intent', null/);
});

test("needs-more reminder requires active sequence parent in RPC", () => {
  assert.match(migrationSql, /create_needs_more_reminder_intent/);
  assert.match(migrationSql, /client_email_needs_more_active_sequence_required/);
});

test("create intent recipient and snapshot validation raises before first parent insert", () => {
  const recipientRaisePos = migrationSql.indexOf("client_email_missing_recipient_email");
  const snapshotRaisePos = migrationSql.indexOf("client_email_missing_intent_snapshot_fields");
  const firstParentInsert = Math.min(
    migrationSql.indexOf("insert into public.client_email_lifecycle_episodes"),
    migrationSql.indexOf("insert into public.client_email_needs_more_targets_sequences"),
  );
  assert.ok(recipientRaisePos >= 0 && recipientRaisePos < firstParentInsert);
  assert.ok(snapshotRaisePos >= 0 && snapshotRaisePos < firstParentInsert);
  assert.doesNotMatch(migrationSql, /'code', 'missing_recipient_email'/);
  assert.doesNotMatch(migrationSql, /'code', 'missing_intent_snapshot_fields'/);
});

test("create intent paths never return ok false after parent create-or-get", () => {
  assert.match(migrationSql, /v_is_create_intent/);
  const postParentSection = migrationSql.slice(
    migrationSql.indexOf("if p_operation in ('open_lifecycle_episode', 'open_needs_more_sequence')"),
  );
  assert.doesNotMatch(postParentSection, /'code', 'missing_recipient_email'/);
  assert.doesNotMatch(postParentSection, /'code', 'missing_intent_snapshot_fields'/);
  assert.doesNotMatch(postParentSection, /'code', 'intent_create_failed'/);
});

test("contract documents atomic materialization invariant and forbids orphan parent on execute path", () => {
  assert.match(contractDoc, /Atomic materialization invariant/);
  assert.match(contractDoc, /one RPC invocation/);
  assert.match(contractDoc, /must \*\*never\*\* chain `open_\*` then `create_\*_initial_intent`/);
  assert.match(contractDoc, /No mandatory two-call initial path/);
  assert.match(contractDoc, /dispatch_uncertain/);
});

test("design does not require two RPC calls for initial materialization", () => {
  assert.equal(isIntentMaterializeOperation("create_lifecycle_initial_intent"), true);
  assert.equal(isIntentMaterializeOperation("create_needs_more_initial_intent"), true);
  assert.equal(isIntentMaterializeOperation("open_lifecycle_episode"), false);
  assert.equal(isIntentMaterializeOperation("open_needs_more_sequence"), false);
  assert.match(precedenceSource, /would_create_initial_intent: 1/);
  assert.match(precedenceSource, /would_open_episode: 2/);
  assert.doesNotMatch(runnerSource, /supabase\.rpc|materializeClientEmailOutboxCandidateInternal/);
  assert.match(runnerSource, /for \(const candidate of input\.effectiveCandidates\)/);
});

test("shadow preview route and runner never invoke materialize RPC", () => {
  assert.doesNotMatch(shadowRoute, /supabase\.rpc|materializeClientEmailOutboxCandidateInternal/);
  assert.doesNotMatch(runnerSource, /supabase\.rpc|materializeClientEmailOutboxCandidateInternal/);
  assert.match(runnerSource, /rpcInvoked: false/);
});

test("idempotency identity conflict uses raise exception for rollback", () => {
  assert.match(migrationSql, /client_email_idempotency_identity_conflict/);
  assert.match(migrationSql, /raise exception/i);
});

test("RPC uses advisory lock per account before parent or intent writes", () => {
  const lockPos = migrationSql.indexOf("pg_advisory_xact_lock");
  const firstParentInsert = Math.min(
    migrationSql.indexOf("insert into public.client_email_lifecycle_episodes"),
    migrationSql.indexOf("insert into public.client_email_needs_more_targets_sequences"),
  );
  assert.ok(lockPos >= 0 && firstParentInsert > lockPos);
});
