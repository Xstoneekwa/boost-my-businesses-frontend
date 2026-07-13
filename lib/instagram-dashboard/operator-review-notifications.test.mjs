import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { deliverOperatorReviewNotifications } from "./operator-review-notifications.ts";

function fakeSupabase() {
  const rows = new Map();
  return {
    rows,
    client: {
      from(table) {
        assert.equal(table, "account_incident_notifications");
        return {
          select() {
            return {
              eq(_column, key) {
                return { maybeSingle: async () => ({ data: rows.get(key) ?? null, error: null }) };
              },
            };
          },
          async insert(row) {
            rows.set(row.delivery_key, { ...row });
            return { error: null };
          },
          update(patch) {
            return {
              async eq(_column, key) {
                rows.set(key, { ...(rows.get(key) ?? {}), ...patch });
                return { error: null };
              },
            };
          },
        };
      },
    },
  };
}

test("operator review notifications deliver Slack and Discord with canonical delivery audit", async () => {
  const supabase = fakeSupabase();
  const posted = [];
  const recorded = [];
  const input = {
    event: "resolved",
    actionId: "action-1",
    incidentId: "incident-1",
    accountId: "account-1",
    accountUsername: "tracker",
    reason: "review complete",
    finalStatus: "resolved",
    operatorId: "operator-1",
  };

  const result = await deliverOperatorReviewNotifications(input, {
    supabase: supabase.client,
    now: () => new Date("2026-07-14T00:30:00.000Z"),
    resolveChannel: async (channel) => ({ sendAllowed: true, webhookUrl: `https://example.invalid/${channel}` }),
    postWebhook: async (channel, _url, body) => {
      posted.push({ channel, body });
      return 204;
    },
    recordResult: async (entry) => recorded.push(entry),
  });

  assert.deepEqual(result.map((row) => row.status), ["sent", "sent"]);
  assert.equal(posted.length, 2);
  assert.equal(recorded.length, 2);
  for (const row of supabase.rows.values()) {
    assert.equal(row.status, "sent");
    assert.equal(row.delivered_at, "2026-07-14T00:30:00.000Z");
    assert.equal(row.metadata.dispatcher, "incident_notifications");
    assert.match(row.payload.text, /Operator: operator-1/);
  }

  await deliverOperatorReviewNotifications(input, {
    supabase: supabase.client,
    resolveChannel: async () => ({ sendAllowed: true, webhookUrl: "https://example.invalid" }),
    postWebhook: async () => {
      throw new Error("duplicate delivery attempted");
    },
    recordResult: async () => {},
  });
});

test("review endpoint uses dedicated RPC and never updates dashboard actions directly", () => {
  const source = readFileSync(new URL("../../app/api/instagram-dashboard/dashboard-actions/review/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20260714003000_operator_review_canonical_transition.sql", import.meta.url), "utf8");
  const creationSource = readFileSync(new URL("./scheduled-early-failure-retry.ts", import.meta.url), "utf8");
  assert.match(source, /rpc\("review_operator_dashboard_action"/);
  assert.match(source, /deliverOperatorReviewNotifications/);
  assert.match(creationSource, /event: "created"/);
  assert.doesNotMatch(source, /from\("account_dashboard_actions"\)\s*\.update/s);
  assert.match(migration, /blocking_campaign = false/);
  assert.match(migration, /operator_review_action_resolved/);
  assert.match(migration, /reviewed_by/);
  assert.match(migration, /reviewed_at/);
  assert.doesNotMatch(migration, /update public\.account_incidents/);
});

test("failed webhook delivery keeps an auditable failed record without delivered_at", async () => {
  const supabase = fakeSupabase();
  const result = await deliverOperatorReviewNotifications({
    event: "created",
    actionId: "action-2",
    incidentId: "incident-2",
    accountId: "account-2",
    accountUsername: "mythyl",
    reason: "operator review required",
    finalStatus: "pending_verification",
    operatorId: "system",
  }, {
    supabase: supabase.client,
    now: () => new Date("2026-07-14T00:30:00.000Z"),
    resolveChannel: async (channel) => ({ sendAllowed: true, webhookUrl: `https://example.invalid/${channel}` }),
    postWebhook: async () => { throw new Error("http_status_503"); },
    recordResult: async () => {},
  });

  assert.deepEqual(result.map((row) => row.status), ["failed", "failed"]);
  for (const row of supabase.rows.values()) {
    assert.equal(row.status, "failed");
    assert.equal(row.delivered_at, null);
    assert.equal(row.last_error, "http_status_503");
  }
});
