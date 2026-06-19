import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clientActivityActionLabel,
  clientActivityDetailLabel,
  clientActivityResultLabel,
  collectForbiddenClientActivityTerms,
  collectForbiddenAmbiguousClientLabels,
  encodeClientActivityCursor,
  decodeClientActivityCursor,
  filterClientActivityItems,
  mapClientInteractionEvent,
  mapClientTargetAuditEvent,
  paginateClientActivityItems,
} from "./client-activity-log-projection.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("client activity route enforces tenant session and ownership", () => {
  const routeSource = source("../../app/api/instagram-client/accounts/[accountId]/activity/route.ts");
  assert.match(routeSource, /requireClientInstagramSession/);
  assert.match(routeSource, /authorizeClientInstagramAccount/);
  assert.match(routeSource, /loadClientAccountActivity/);
  assert.doesNotMatch(routeSource, /get_activity_log_interaction_evidence_admin/);
});

test("client activity maps interaction events with target and touched accounts", () => {
  const mapped = mapClientInteractionEvent({
    id: "evt-1",
    event_type: "follow_sent",
    event_status: "success",
    event_at: "2026-06-08T20:56:09.487Z",
    source_target_username: "moondustagency",
    username: "example_profile",
  }, "i_m_your_traker", "fr");

  assert.ok(mapped);
  assert.equal(mapped?.instagramAccount, "@i_m_your_traker");
  assert.equal(mapped?.targetAccount, "@moondustagency");
  assert.equal(mapped?.touchedAccount, "@example_profile");
  assert.equal(mapped?.actionLabel, "Compte suivi");
  assert.equal(mapped?.resultLabel, "Réussi");
});

test("client activity hides internal interaction event types", () => {
  assert.equal(mapClientInteractionEvent({
    id: "evt-2",
    event_type: "follow_verified",
    event_status: "success",
    event_at: "2026-06-08T20:56:09.487Z",
  }, "i_m_your_traker", "fr"), null);
});

test("client activity maps audit rejection reasons to client-safe detail", () => {
  const mapped = mapClientTargetAuditEvent({
    id: "audit-1",
    created_at: "2026-06-17T16:25:11.915Z",
    operation: "target_add_single",
    result: "rejected",
    reason: "followers_count_below_minimum",
    target_id: "75c85649-7459-4885-b6fb-f2638ed3991a",
    metadata_safe: { source_surface: "client_dashboard" },
  }, "i_m_your_traker", "low_followers_user", "fr");

  assert.equal(mapped.actionLabel, "Compte cible ajouté");
  assert.equal(mapped.resultLabel, "Non effectué");
  assert.equal(mapped.detailLabel, "Trop peu d'abonnés");
  assert.equal(mapped.targetAccount, "@low_followers_user");
});

test("client activity action and result labels stay client-safe", () => {
  assert.equal(clientActivityActionLabel({ eventType: "post_like_success" }, "fr").label, "Publication aimée");
  assert.equal(clientActivityActionLabel({ operation: "target_archive" }, "fr").label, "Compte cible retiré");
  assert.equal(clientActivityResultLabel({ status: "skipped" }, "fr").label, "Non effectué");
  assert.equal(clientActivityResultLabel({ result: "accepted" }, "fr").label, "Réussi");
  assert.equal(clientActivityDetailLabel({ reason: "profile_is_verified", lang: "fr" }), "Compte certifié");
});

test("client activity maps mute_success as account muted with precise detail", () => {
  const mapped = mapClientInteractionEvent({
    id: "evt-mute",
    event_type: "mute_success",
    event_status: "success",
    event_at: "2026-06-08T20:56:10.637Z",
    source_target_username: "moondustagency",
    username: "example_profile",
    payload: { muted_posts: true, muted_stories: true, mute_partial: false },
  }, "i_m_your_traker", "fr");

  assert.ok(mapped);
  assert.equal(mapped?.actionLabel, "Compte mis en sourdine");
  assert.equal(mapped?.detailLabel, "Publications et stories masquées");
});

test("client activity response projection excludes forbidden technical terms", () => {
  const rows = [
    mapClientInteractionEvent({
      id: "evt-3",
      event_type: "follow_sent",
      event_status: "success",
      event_at: "2026-06-08T20:56:09.487Z",
      source_target_username: "moondustagency",
      username: "example_profile",
      run_id: "secret-run-id-should-not-appear",
      evidence_summary: "raw evidence",
    }, "i_m_your_traker", "fr"),
    mapClientTargetAuditEvent({
      id: "audit-2",
      created_at: "2026-06-17T16:25:11.915Z",
      operation: "target_add_single",
      result: "rejected",
      reason: "not_relevant",
    }, "i_m_your_traker", "bad_fit_user", "fr"),
  ].filter(Boolean);

  const sample = paginateClientActivityItems(rows, { limit: 50 });

  const forbidden = collectForbiddenClientActivityTerms(sample);
  assert.deepEqual(forbidden, []);
  assert.deepEqual(collectForbiddenAmbiguousClientLabels(sample), []);
  assert.doesNotMatch(JSON.stringify(sample), /run_id|worker|supabase|evidence/i);
});

test("client activity search filters by target, touched, action and result labels", () => {
  const rows = [
    mapClientInteractionEvent({
      id: "evt-4",
      event_type: "follow_sent",
      event_status: "success",
      event_at: "2026-06-08T20:56:09.487Z",
      source_target_username: "moondustagency",
      username: "example_profile",
    }, "i_m_your_traker", "fr"),
    mapClientTargetAuditEvent({
      id: "audit-3",
      created_at: "2026-06-17T16:25:11.915Z",
      operation: "target_add_single",
      result: "rejected",
      reason: "profile_is_verified",
    }, "i_m_your_traker", "verified_user", "fr"),
  ].filter(Boolean);

  const byTouched = filterClientActivityItems(rows, { search: "example_profile" });
  assert.equal(byTouched.length, 1);
  assert.equal(byTouched[0]?.touchedAccount, "@example_profile");

  const byResult = filterClientActivityItems(rows, { result: "skipped" });
  assert.equal(byResult.length, 1);
  assert.equal(byResult[0]?.targetAccount, "@verified_user");
});

test("client activity pagination returns next cursor", () => {
  const rows = [
    mapClientInteractionEvent({
      id: "evt-a",
      event_type: "follow_sent",
      event_status: "success",
      event_at: "2026-06-08T20:56:09.487Z",
      source_target_username: "alpha",
      username: "one",
    }, "campaign", "fr"),
    mapClientInteractionEvent({
      id: "evt-b",
      event_type: "post_like_success",
      event_status: "success",
      event_at: "2026-06-07T20:56:09.487Z",
      source_target_username: "beta",
      username: "two",
    }, "campaign", "fr"),
  ].filter(Boolean);

  const firstPage = paginateClientActivityItems(rows, { limit: 1 });
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.nextCursor);

  const cursor = decodeClientActivityCursor(firstPage.nextCursor);
  assert.ok(cursor);
  const secondPage = paginateClientActivityItems(rows, { limit: 1, cursor: firstPage.nextCursor });
  assert.equal(secondPage.items.length, 1);
  assert.notEqual(secondPage.items[0]?.actionLabel, firstPage.items[0]?.actionLabel);
});

test("client activity empty state is supported by zero-item pagination", () => {
  const page = paginateClientActivityItems([], { limit: 50 });
  assert.deepEqual(page.items, []);
  assert.equal(page.nextCursor, null);
});

test("client activity dashboard wires dedicated panel", () => {
  const dashboardSource = source("../../app/instagram-client/ClientDashboard.tsx");
  const panelSource = source("../../app/instagram-client/ClientActivityPanel.tsx");
  assert.match(dashboardSource, /ClientActivityPanel/);
  assert.match(panelSource, /Compte cible/);
  assert.doesNotMatch(panelSource, /Compte ciblé|Comptes ciblés|Compte protégé/);
});

test("client activity cursor encoding roundtrips", () => {
  const encoded = encodeClientActivityCursor("2026-06-08T20:56:09.487Z|interaction|evt-1");
  assert.equal(decodeClientActivityCursor(encoded), "2026-06-08T20:56:09.487Z|interaction|evt-1");
});
