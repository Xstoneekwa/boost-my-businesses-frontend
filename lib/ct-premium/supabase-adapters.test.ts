import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseCtCommandAdapter, SupabaseCtIntentAdapter, SupabaseCtReadRepository } from "./supabase-adapters.ts";

const neverCalledClient = new Proxy({}, {
  get() { throw new Error("database_client_should_not_be_called_while_disabled"); },
});

test("database adapters fail closed while the feature is disabled", async () => {
  const command = new SupabaseCtCommandAdapter(neverCalledClient as never, { enabled: false });
  const reads = new SupabaseCtReadRepository(neverCalledClient as never, { enabled: false });
  const intents = new SupabaseCtIntentAdapter(neverCalledClient as never, { enabled: false });

  await assert.rejects(() => command.recompute({
    accountId: "account" as never, targetId: "target" as never,
    estimatedExploitableAudience: 100, denominatorSource: "test", denominatorVersion: "v1",
    confidence: "high", assessmentKey: "test", assessedAt: new Date(0).toISOString(),
  }), /ct_database_adapter_disabled/);
  await assert.rejects(() => reads.list("tenant" as never,"account" as never), /ct_database_adapter_disabled/);
  await assert.rejects(() => intents.record({
    tenantId:"tenant" as never,accountId:"account" as never,batchId:"batch" as never,
    kind:"batch_ready",createdAt:new Date(0).toISOString(),
  }), /ct_database_adapter_disabled/);
});
