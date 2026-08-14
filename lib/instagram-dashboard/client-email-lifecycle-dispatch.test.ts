import assert from "node:assert/strict";
import test from "node:test";
import { revalidateLifecycleDispatchIntent } from "./client-email-outbox-dispatch.ts";

type RecordValue = Record<string, unknown> | null;

function queryResult(data: RecordValue) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data, error: null }),
  };
  return chain;
}

function buildSupabase(input: {
  link?: RecordValue;
  episode?: RecordValue;
  account?: RecordValue;
  suppressed?: RecordValue;
}) {
  return {
    from(table: string) {
      if (table === "client_instagram_accounts") {
        return queryResult(input.link === undefined ? { client_id: "client-1" } : input.link);
      }
      if (table === "client_email_lifecycle_episodes") {
        return queryResult(input.episode ?? {
          id: "episode-1",
          status: "active",
          account_id: "account-1",
          client_id: "client-1",
          category: "account_paused",
        });
      }
      if (table === "ig_accounts") {
        return queryResult(input.account ?? { admin_lifecycle_status: "paused" });
      }
      if (table === "client_email_suppressions") {
        return queryResult(input.suppressed ?? null);
      }
      if (table === "client_email_delivery_events") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: async () => ({ data: input.suppressed ? [input.suppressed] : [], error: null }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    account_id: "account-1",
    client_id: "client-1",
    lifecycle_episode_id: "episode-1",
    category: "account_paused",
    recipient_email: "client@example.com",
    scheduled_for: "2026-08-14T18:00:00.000Z",
    ...overrides,
  };
}

test("active paused episode is dispatchable only while canonical Pause remains active", async () => {
  const result = await revalidateLifecycleDispatchIntent(
    buildSupabase({}) as never,
    intent(),
    new Date("2026-08-14T18:01:00.000Z"),
  );
  assert.deepEqual(result, { ok: true });
});

test("resolved Pause state cancels stale intent before provider dispatch", async () => {
  const result = await revalidateLifecycleDispatchIntent(
    buildSupabase({ account: { admin_lifecycle_status: "active" } }) as never,
    intent(),
    new Date("2026-08-14T18:01:00.000Z"),
  );
  assert.deepEqual(result, { ok: false, cancel: true, reason: "lifecycle_state_cleared" });
});

test("tenant-account mismatch fails closed before provider dispatch", async () => {
  const result = await revalidateLifecycleDispatchIntent(
    buildSupabase({ link: null }) as never,
    intent(),
    new Date("2026-08-14T18:01:00.000Z"),
  );
  assert.deepEqual(result, { ok: false, cancel: true, reason: "tenant_account_mismatch" });
});

test("resolved or historical episode cannot be resurrected by refresh", async () => {
  const result = await revalidateLifecycleDispatchIntent(
    buildSupabase({
      episode: {
        id: "episode-1",
        status: "resolved",
        account_id: "account-1",
        client_id: "client-1",
        category: "account_paused",
      },
    }) as never,
    intent(),
    new Date("2026-08-14T18:01:00.000Z"),
  );
  assert.deepEqual(result, { ok: false, cancel: true, reason: "lifecycle_episode_inactive" });
});
