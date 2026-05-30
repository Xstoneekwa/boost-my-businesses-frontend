import assert from "node:assert/strict";
import test from "node:test";
import { mapCtTargetAuditEvent } from "../app/instagram-dashboard/activity-log-data.ts";

test("maps CT lifecycle audit rows to safe Activity Log items", () => {
  const accounts = new Map([["account-1", "@source_account"]]);
  const targets = new Map([["target-1", "@target_user"]]);
  const item = mapCtTargetAuditEvent({
    id: "audit-1",
    created_at: "2026-05-30T03:00:00.000Z",
    account_id: "account-1",
    target_id: "target-1",
    operation: "target_restore",
    result: "restored",
    reason: "manual_restore_quality_fresh",
    actor_type: "admin",
    batch_id: "00000000-0000-4000-8000-00000000c501",
    metadata_safe: {
      source_surface: "admin_dashboard",
      previous_status: "archived",
      next_status: "valid",
      raw_provider_response: "must_not_render",
      token: "must_not_render",
    },
  }, accounts, targets);

  assert.equal(item.domain, "targets");
  assert.equal(item.action, "Restore target");
  assert.equal(item.result, "restored");
  assert.equal(item.username, "@source_account");
  assert.equal(item.targetLabel, "@target_user");
  assert.equal(item.batchIdShort, "00000000");
  assert.equal(item.sourceSurface, "admin_dashboard");
  assert.equal(item.metadataStatus, "safe_projection");
  assert.match(item.safeSummary, /archived -> valid/);
  assert.doesNotMatch(item.safeSummary, /must_not_render/);
  assert.doesNotMatch(item.sourceLabel, /must_not_render/);
});

test("keeps reset and archive actions distinct from restore", () => {
  const reset = mapCtTargetAuditEvent({
    operation: "target_reset",
    result: "accepted",
    reason: "manual_reset",
    actor_type: "admin",
    metadata_safe: { source_surface: "admin_dashboard" },
  });
  const archive = mapCtTargetAuditEvent({
    operation: "target_archive",
    result: "archived",
    reason: "dashboard_archive",
    actor_type: "admin",
    metadata_safe: { source_surface: "admin_dashboard" },
  });

  assert.equal(reset.action, "Reset target verification");
  assert.equal(reset.result, "accepted");
  assert.equal(archive.action, "Archive target");
  assert.equal(archive.result, "archived");
});
