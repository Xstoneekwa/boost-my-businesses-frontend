import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../migrations/20260730123708_ct_target_availability_identity_assessment_current_v1.sql", import.meta.url);
const rollbackPath = new URL("../rollback/20260730123708_ct_target_availability_identity_assessment_current_v1.down.sql", import.meta.url);

const migration = await readFile(migrationPath, "utf8");
const rollback = await readFile(rollbackPath, "utf8");

function extractAddedColumns(sql) {
  const columns = [];
  for (const statement of sql.matchAll(/alter table public\.(\w+)\s+([\s\S]*?);/gi)) {
    for (const column of statement[2].matchAll(/\badd column\s+(\w+)\b/gi)) {
      columns.push(`${statement[1]}.${column[1]}`);
    }
  }
  return columns;
}

function extractDroppedColumns(sql) {
  const columns = [];
  for (const statement of sql.matchAll(/alter table public\.(\w+)\s+([\s\S]*?);/gi)) {
    for (const column of statement[2].matchAll(/\bdrop column if exists\s+(\w+)\b/gi)) {
      columns.push(`${statement[1]}.${column[1]}`);
    }
  }
  return columns;
}

const addedColumns = extractAddedColumns(migration);

test("migration is explicitly local, additive and contains no business data mutation", () => {
  assert.match(migration, /NOT DEPLOYED/);
  assert.doesNotMatch(migration, /\bdrop\s+(?:table|column|constraint|index)\b/i);
  assert.doesNotMatch(migration, /^\s*(?:insert\s+into|update|delete\s+from|truncate)\s+/im);
  assert.doesNotMatch(migration, /security\s+definer/i);
  assert.doesNotMatch(migration, /\big_targets\b.*(?:update|delete|insert)/i);
});

test("all required Identity, Assessment and Current fields are additive", () => {
  for (const field of [
    "transition_type_v3", "evidence_count", "first_observed_at", "last_observed_at",
    "source_observation_ids", "observed_username", "domain_identity_status", "first_seen_at",
    "last_seen_at", "last_confirmed_at", "stale_after", "source_version",
    "assessment_status_v3", "identity_status_v3", "contributing_observation_ids",
    "ignored_observation_ids", "repeat_count", "rule_version", "engine_version",
    "first_evidence_at", "last_evidence_at", "valid_until", "explanation_safe",
    "availability_status", "latest_observation_at", "confirmed_at", "reason_codes",
    "policy_version", "engine_revision", "policy_revision",
  ]) assert.match(migration, new RegExp(`\\b${field}\\b`), field);
});

test("SQL artifact is the canonical 41-column contract", () => {
  assert.equal(addedColumns.length, 41);
  assert.equal(new Set(addedColumns).size, 41, "every additive column must be unique");
  assert.deepEqual(
    Object.fromEntries([
      "ct_target_identity_history",
      "ct_target_identity_current",
      "ct_target_availability_assessments",
      "ct_target_availability_current",
    ].map((table) => [table, addedColumns.filter((entry) => entry.startsWith(`${table}.`)).length])),
    {
      ct_target_identity_history: 7,
      ct_target_identity_current: 8,
      ct_target_availability_assessments: 14,
      ct_target_availability_current: 12,
    },
  );
  for (const requiredProjectionVersion of [
    "engine_version", "policy_version", "engine_revision", "policy_revision",
  ]) {
    assert.ok(
      addedColumns.includes(`ct_target_availability_current.${requiredProjectionVersion}`),
      requiredProjectionVersion,
    );
  }
});

test("documentary rollback covers the exact canonical column set", () => {
  const droppedColumns = extractDroppedColumns(rollback);
  assert.deepEqual([...droppedColumns].sort(), [...addedColumns].sort());
});

test("RLS and least-privilege grants remain fail closed", () => {
  for (const table of [
    "ct_target_identity_history", "ct_target_identity_current",
    "ct_target_availability_assessments", "ct_target_availability_current",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, "i"));
    assert.match(migration, new RegExp(`revoke all privileges on table public\\.${table} from public, anon, authenticated, service_role`, "i"));
  }
  assert.doesNotMatch(migration, /grant\s+.+\s+to\s+(?:public|anon|authenticated)\b/i);
  assert.match(migration, /grant select, insert on table public\.ct_target_identity_history to service_role/i);
  assert.match(migration, /grant select, insert, update on table public\.ct_target_identity_current to service_role/i);
  assert.match(migration, /grant select, insert on table public\.ct_target_availability_assessments to service_role/i);
  assert.match(migration, /grant select, insert, update on table public\.ct_target_availability_current to service_role/i);
  assert.doesNotMatch(migration, /grant\s+(?:delete|truncate|references|trigger)/i);
});

test("rollback is documentary, scoped and excludes observations or legacy tables", () => {
  assert.match(rollback, /DOCUMENTARY ROLLBACK ONLY/);
  assert.doesNotMatch(rollback, /ct_target_availability_observations/i);
  assert.doesNotMatch(rollback, /\big_targets\b|\big_accounts\b|\bclients\b/i);
  assert.doesNotMatch(rollback, /^\s*(?:delete|truncate|update|insert)\s+/im);
});
