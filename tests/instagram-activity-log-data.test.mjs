import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildNoInteractionMessage,
  itemMatchesInvestigationQuery,
  mapCtTargetAuditEvent,
  mapInteractionEvidenceRow,
} from "../app/instagram-dashboard/activity-log-data.ts";

const activityLogDataSource = readFileSync(new URL("../app/instagram-dashboard/activity-log-data.ts", import.meta.url), "utf8");

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

test("maps interaction evidence projection without rendering technical payloads", () => {
  const item = mapInteractionEvidenceRow({
    source_record_id: "22222222-3333-4444-8555-666666666666",
    evidence_source_table: "ig_interaction_events",
    account_id: "account-1",
    client_id: "client-1",
    client_account_username: "client_account",
    ct_id: "33333333-4444-4555-8666-777777777777",
    ct_username: "source_ct",
    interacted_username: "target_user",
    action_type: "follow",
    action_status: "success",
    occurred_at: "2026-06-11T09:00:00.000Z",
    run_id: "44444444-5555-4666-8777-888888888888",
    request_id: "55555555-6666-4777-8888-999999999999",
    safe_device_label: "PHONE 1",
    evidence_confidence: "high",
    evidence_summary: "Follow sent by @client_account via CT @source_ct.",
    metadata_safe: { source: "worker_interaction_event" },
  });

  assert.equal(item.action, "Follow");
  assert.equal(item.result, "success");
  assert.equal(item.username, "@client_account");
  assert.equal(item.targetLabel, "@target_user");
  assert.equal(item.reason, "high");
  assert.equal(item.sourceSurface, "activity_log_investigation");
  assert.match(item.sourceLabel, /ig_interaction_events/);
  assert.match(item.safeSummary, /source_ct/);
  assert.doesNotMatch(item.safeSummary, /PHONE 1/);
});

test("loads interaction evidence projection before legacy CT audit fallback", () => {
  const getDataStart = activityLogDataSource.indexOf("export async function getActivityLogData");
  const getDataEnd = activityLogDataSource.indexOf("async function loadInteractionEvidenceItems");
  const getDataBody = activityLogDataSource.slice(getDataStart, getDataEnd);
  const evidenceIndex = getDataBody.indexOf("loadInteractionEvidenceItems");
  const fallbackIndex = getDataBody.indexOf('from("ct_target_audit_events")');

  assert.notEqual(evidenceIndex, -1);
  assert.notEqual(fallbackIndex, -1);
  assert.ok(evidenceIndex < fallbackIndex);
  assert.ok(activityLogDataSource.includes('rpc("get_activity_log_interaction_evidence_admin"'));
});

test("filters interaction evidence by CT and interacted account", () => {
  const item = mapInteractionEvidenceRow({
    source_record_id: "22222222-3333-4444-8555-666666666666",
    evidence_source_table: "ig_interaction_events",
    account_id: "account-1",
    client_account_username: "client_account",
    ct_id: "33333333-4444-4555-8666-777777777777",
    ct_username: "source_ct",
    interacted_username: "target_user",
    action_type: "follow",
    action_status: "success",
    occurred_at: "2026-06-11T09:00:00.000Z",
    evidence_confidence: "high",
    evidence_summary: "Follow sent by @client_account via CT @source_ct.",
  });
  const now = new Date("2026-06-11T12:00:00.000Z");

  assert.equal(itemMatchesInvestigationQuery(item, {
    mode: "search_by_ct",
    search: "@source_ct",
    period: "24h",
    actionType: "follow",
    clientAccount: "all",
    status: "success",
  }, now), true);

  assert.equal(itemMatchesInvestigationQuery(item, {
    mode: "search_by_account",
    search: "target_user",
    period: "24h",
    actionType: "all",
    clientAccount: "client_account",
    status: "all",
  }, now), true);

  assert.equal(itemMatchesInvestigationQuery(item, {
    mode: "search_by_ct",
    search: "other_ct",
    period: "24h",
    actionType: "all",
    clientAccount: "all",
    status: "all",
  }, now), false);
});

test("builds exact no-result wording for investigation searches", () => {
  assert.equal(
    buildNoInteractionMessage("@missing_user"),
    "No interaction found for @missing_user in the selected period.",
  );
  assert.equal(
    buildNoInteractionMessage(""),
    "No interaction found for the selected filters in the selected period.",
  );
});
