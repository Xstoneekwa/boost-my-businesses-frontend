import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const listSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("./[incidentId]/route.ts", import.meta.url), "utf8");
const actionSource = readFileSync(new URL("./action/route.ts", import.meta.url), "utf8");

test("all incident endpoints require relay or admin authentication", () => {
  for (const source of [listSource, detailSource, actionSource]) {
    assert.match(source, /requireRelayOrAdmin\(request/);
    assert.match(source, /if \(unauthorizedResponse\) return unauthorizedResponse;/);
  }
});

test("incident list reads the canonical incident + outbox tables only", () => {
  assert.match(listSource, /from\("account_incidents"\)/);
  assert.match(listSource, /from\("account_incident_notifications"\)/);
  assert.match(listSource, /buildIncidentList/);
  assert.match(listSource, /buildIncidentCounters/);
});

test("incident list validates status and severity filters", () => {
  assert.match(listSource, /VALID_STATUSES/);
  assert.match(listSource, /VALID_SEVERITIES/);
  assert.match(listSource, /"open", "acknowledged", "resolved", "ignored"/);
});

test("incident list exposes the BotApp bridge summary contract", () => {
  assert.match(listSource, /openCount: counters\.open \+ counters\.actionRequired/);
  assert.match(listSource, /actionRequiredCount: counters\.actionRequired/);
  assert.match(listSource, /deliveryDegradedCount: counters\.deliveryDegraded/);
  assert.match(listSource, /generatedAt/);
});

test("test incidents are excluded from lists unless include_test=1", () => {
  assert.match(listSource, /include_test/);
  assert.match(listSource, /includeTest/);
  // Counters are always computed on operational incidents (lib excludes tests).
  assert.match(listSource, /includeTest: true/);
});

test("incident detail returns notifications with per-channel delivery state", () => {
  assert.match(detailSource, /from\("account_incident_notifications"\)/);
  assert.match(detailSource, /attemptCount: delivery\.attemptCount/);
  assert.match(detailSource, /deliveredAt: delivery\.deliveredAt/);
  assert.match(detailSource, /Incident not found\./);
});

test("incident detail keeps the stable reason code for the drawer", () => {
  assert.match(detailSource, /reason: model\.reasonCode/);
  assert.match(detailSource, /mapIncidentRow/);
});

test("incident routes only expose redacted metadata through the view model", () => {
  // Raw metadata must never be returned directly: the lib maps it to
  // metadataSafe via redactIncidentMetadata.
  assert.doesNotMatch(listSource, /metadata: row\.metadata/);
  assert.doesNotMatch(detailSource, /metadata: incidentRow\.metadata/);
});

test("incident actions are limited to status-only operations in P2", () => {
  assert.match(actionSource, /"acknowledge", "resolve", "keep_paused"/);
  assert.doesNotMatch(actionSource, /"manual_retry"/);
  assert.match(actionSource, /action_reserved_for_next_checkpoint/);
});

test("incident actions can never create a run or run request", () => {
  assert.match(actionSource, /runCreated: false/);
  assert.doesNotMatch(actionSource, /ig_runs|account_run_requests|run_requests/);
  assert.doesNotMatch(actionSource, /\.insert\(/);
});
