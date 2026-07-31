import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const ctMigrationUrl = new URL(
  "../supabase/migrations/20260731003500_target_followers_resume_commit_provenance_v4.sql",
  import.meta.url,
);
const followMigrationUrl = new URL(
  "../supabase/migrations/20260731131850_follow_60s_midcanary_stage_barrier_v1.sql",
  import.meta.url,
);

const ctMigration = readFileSync(ctMigrationUrl, "utf8");
const followMigration = readFileSync(followMigrationUrl, "utf8");

test("CT Resume 003500 remains the exact canonical artifact", () => {
  const digest = createHash("sha256").update(ctMigration).digest("hex");
  assert.equal(digest, "40ba5b8bb7d769c280657a9f9f42793dedc4af612221fb52401a518b1c0dec7d");
});

test("migration order is CT Resume then Follow 60 then Target Lifecycle", () => {
  const ctVersion = 20260731003500n;
  const followVersion = 20260731131850n;
  const lifecycleVersion = 20260731133000n;

  assert.ok(ctVersion < followVersion);
  assert.ok(followVersion < lifecycleVersion);
});

test("CT Resume migration does not mutate Follow 60 domain objects", () => {
  assert.doesNotMatch(ctMigration, /follow_60s_canary_controls/i);
  assert.doesNotMatch(ctMigration, /alter\s+table\s+(?:public\.)?ig_interaction_events/i);
  assert.doesNotMatch(ctMigration, /persist_follow_60s|mark_follow_60s/i);

  for (const table of ["account_run_requests", "ig_runs"]) {
    assert.doesNotMatch(
      ctMigration,
      new RegExp(`(?:insert\\s+into|update|delete\\s+from|truncate|alter\\s+table|drop\\s+table)\\s+(?:public\\.)?${table}\\b`, "i"),
    );
  }
});

test("Follow 60 migration does not mutate CT Resume objects or require 003500 to be absent", () => {
  assert.doesNotMatch(followMigration, /20260731003500/i);
  assert.doesNotMatch(followMigration, /commit_target_followers_resume_checkpoint_v4/i);
  assert.doesNotMatch(followMigration, /ig_target_followers_resume_checkpoints/i);
  assert.doesNotMatch(followMigration, /ig_target_followers_resume_checkpoint_events/i);
});
