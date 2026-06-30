import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateClientEmailLifecycleCronAuth,
  extractClientEmailLifecycleCronSecret,
  runClientEmailLifecycleCron,
} from "./client-email-lifecycle-cron.ts";
import { detectClientEmailLifecycleCronInvoker } from "./client-email-lifecycle-scheduler-health.ts";
import {
  cancelDispatchIntent,
  claimNeedsMoreDispatchIntent,
} from "./client-email-outbox-dispatch.ts";
import { createPostmarkClientEmailAdapter } from "./client-email-postmark-adapter.ts";

const watermarkEnv = {
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT: "2026-06-29T13:00:00Z",
  CLIENT_EMAIL_MATERIALIZE_ENABLED: "false",
  CLIENT_EMAIL_SENDING_ENABLED: "false",
  CRON_SECRET: "cron-secret",
};

test("cron auth rejects missing and invalid secrets", () => {
  const missing = evaluateClientEmailLifecycleCronAuth(watermarkEnv, "");
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.reason, "missing_caller_secret");

  const invalid = evaluateClientEmailLifecycleCronAuth(watermarkEnv, "wrong");
  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.equal(invalid.reason, "invalid_caller_secret");
});

test("extractClientEmailLifecycleCronSecret reads bearer and header", () => {
  const bearer = new Request("https://example.com", {
    headers: { authorization: "Bearer abc123" },
  });
  assert.equal(extractClientEmailLifecycleCronSecret(bearer), "abc123");

  const header = new Request("https://example.com", {
    headers: { "x-cron-secret": "header-secret" },
  });
  assert.equal(extractClientEmailLifecycleCronSecret(header), "header-secret");
});

test("manual cron tick stays awaiting_first_native_tick in scheduler projection", async () => {
  let metadata: Record<string, unknown> | null = null;
  const supabase = {
    from(table: string) {
      if (table === "worker_heartbeats") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { metadata }, error: null }),
            }),
          }),
          upsert: (values: Record<string, unknown>) => {
            metadata = values.metadata as Record<string, unknown>;
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          in: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      };
    },
  };

  const run = await runClientEmailLifecycleCron({
    supabase: supabase as never,
    callerSecret: "cron-secret",
    invoker: "manual",
    env: {
      ...watermarkEnv,
      CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "false",
    },
  });

  assert.equal(run.status, 200);
  if (run.status !== 200) return;
  assert.equal(run.result.invoker, "manual");
  assert.equal(run.result.schedulerStatus, "awaiting_first_native_tick");
  assert.equal(metadata?.native_tick_count ?? 0, 0);
});

test("native cron tick records scheduler heartbeat metadata", async () => {
  let metadata: Record<string, unknown> | null = null;
  const supabase = {
    from(table: string) {
      if (table === "worker_heartbeats") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { metadata }, error: null }),
            }),
          }),
          upsert: (values: Record<string, unknown>) => {
            metadata = values.metadata as Record<string, unknown>;
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          in: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      };
    },
  };

  const run = await runClientEmailLifecycleCron({
    supabase: supabase as never,
    callerSecret: "cron-secret",
    invoker: "vercel_native",
    env: {
      ...watermarkEnv,
      CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "false",
    },
  });

  assert.equal(run.status, 200);
  if (run.status !== 200) return;
  assert.equal(run.result.invoker, "vercel_native");
  assert.equal(run.result.schedulerStatus, "healthy");
  assert.equal(metadata?.native_tick_count, 1);
});

test("detectClientEmailLifecycleCronInvoker is exported for route wiring", () => {
  const headers = new Headers({ "x-vercel-cron": "1" });
  assert.equal(detectClientEmailLifecycleCronInvoker(headers), "vercel_native");
});

test("cron with automation closed records scheduler heartbeat only", async () => {
  let writes = 0;
  const supabase = {
    from(table: string) {
      if (table === "worker_heartbeats") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { metadata: null }, error: null }),
            }),
          }),
          upsert: async () => {
            writes += 1;
            return { error: null };
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          in: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      };
    },
  };

  const run = await runClientEmailLifecycleCron({
    supabase: supabase as never,
    callerSecret: "cron-secret",
    invoker: "manual",
    env: {
      ...watermarkEnv,
      CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "false",
    },
  });

  assert.equal(run.status, 200);
  if (run.status !== 200) return;
  assert.equal(run.result.skipped, true);
  assert.equal(run.result.materialize.materialized, 0);
  assert.equal(run.result.dispatch.submitted, 0);
  assert.equal(writes, 1);
});

test("claim is idempotent for already claimed live lease", async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const supabase = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "intent-1",
                status: "claimed",
                provider_message_id: null,
                claim_expires_at: future,
              },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            in: () => ({
              is: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      };
    },
  };

  const claimed = await claimNeedsMoreDispatchIntent(supabase as never, "intent-1", new Date());
  assert.equal(claimed, null);
});

test("postmark adapter returns submitted on mock success", async () => {
  const adapter = createPostmarkClientEmailAdapter({
    CLIENT_EMAIL_SENDING_ENABLED: "true",
    CLIENT_EMAIL_PROVIDER: "postmark",
    POSTMARK_SERVER_TOKEN: "token",
  }, async () => new Response(JSON.stringify({ MessageID: "provider-msg-1" }), { status: 200 }));

  const result = await adapter.send({
    intentId: "intent-1",
    fromEmail: "growth@boostmybusinesses.com",
    recipientEmail: "client@example.com",
    subject: "Subject",
    bodyText: "Body",
    bodyHtml: "<p>Body</p>",
    messageStream: "outbound",
    category: "needs_more_target_accounts",
    accountId: "acct-1",
    trigger: "automatic_initial",
    reminderIndex: 0,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.providerMessageId, "provider-msg-1");
});

test("postmark adapter maps timeout to provider_timeout", async () => {
  const adapter = createPostmarkClientEmailAdapter({
    CLIENT_EMAIL_SENDING_ENABLED: "true",
    CLIENT_EMAIL_PROVIDER: "postmark",
    POSTMARK_SERVER_TOKEN: "token",
  }, async () => {
    throw new Error("network");
  });

  const result = await adapter.send({
    intentId: "intent-1",
    fromEmail: "growth@boostmybusinesses.com",
    recipientEmail: "client@example.com",
    subject: "Subject",
    bodyText: "Body",
    bodyHtml: "<p>Body</p>",
    messageStream: "outbound",
    category: "needs_more_target_accounts",
    accountId: "acct-1",
    trigger: "automatic_initial",
    reminderIndex: 0,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "provider_timeout");
});

test("cancelDispatchIntent uses stable reason code", async () => {
  let captured: Record<string, unknown> | null = null;
  const supabase = {
    from() {
      return {
        update: (values: Record<string, unknown>) => {
          captured = values;
          return {
            eq: () => ({
              in: async () => ({ error: null }),
            }),
          };
        },
      };
    },
  };

  await cancelDispatchIntent(supabase as never, "intent-1", "eligible_targets_above_threshold", new Date());
  assert.equal(captured?.status, "canceled");
  assert.match(String(captured?.dispatch_last_error_code ?? ""), /eligible_targets_above_threshold/);
});
