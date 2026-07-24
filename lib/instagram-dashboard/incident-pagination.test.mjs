import assert from "node:assert/strict";
import test from "node:test";

import {
  clampIncidentPageSize,
  decodeIncidentCursor,
  encodeIncidentCursor,
  normalizeIncidentFilter,
} from "./incident-pagination.ts";

const cursor = {
  lastSeenAt: "2026-07-24T12:00:00.000Z",
  id: "773ccb0a-74f1-48db-bad1-fa337a24b158",
};

test("incident cursor is opaque, stable and round-trips", () => {
  const encoded = encodeIncidentCursor(cursor);
  assert.ok(encoded);
  assert.doesNotMatch(encoded, /2026-07-24/);
  assert.deepEqual(decodeIncidentCursor(encoded), cursor);
});

test("invalid incident cursors are rejected without throwing", () => {
  assert.equal(decodeIncidentCursor("not-base64-json"), null);
  assert.equal(decodeIncidentCursor(Buffer.from(JSON.stringify({ lastSeenAt: "bad", id: "bad" })).toString("base64url")), null);
  assert.equal(decodeIncidentCursor(null), null);
});

test("incident filter and page size are bounded", () => {
  assert.equal(normalizeIncidentFilter("action_required"), "action_required");
  assert.equal(normalizeIncidentFilter("resolved"), "resolved");
  assert.equal(normalizeIncidentFilter("unexpected"), "open");
  assert.equal(clampIncidentPageSize(500), 100);
  assert.equal(clampIncidentPageSize(0), 1);
  assert.equal(clampIncidentPageSize(Number.NaN), 50);
});
