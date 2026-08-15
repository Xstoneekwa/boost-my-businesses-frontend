import assert from "node:assert/strict";
import test from "node:test";
import { mapWithBoundedConcurrency, nextCommercialAttemptAt, planCommercialBatch } from "./discovery-execution.ts";

test("30 items require six bounded continuations and never one invocation", async () => {
  let remaining = Array.from({ length: 30 }, (_, index) => index); let continuations = 0; let active = 0; let peak = 0; const completed: number[] = [];
  while (remaining.length) {
    const batch = planCommercialBatch(remaining, 5); remaining = remaining.slice(batch.length); continuations += 1;
    await mapWithBoundedConcurrency(batch, 2, async (value) => { active += 1; peak = Math.max(peak, active); await Promise.resolve(); completed.push(value); active -= 1; });
  }
  assert.equal(completed.length, 30); assert.equal(continuations, 6); assert.ok(peak <= 2);
});

test("resume starts with remaining durable items and retry backoff is finite", () => {
  const durable = Array.from({ length: 30 }, (_, index) => ({ id: index, status: index < 10 ? "completed" : "pending" }));
  assert.deepEqual(planCommercialBatch(durable.filter((item) => item.status === "pending"), 5).map((item) => item.id), [10, 11, 12, 13, 14]);
  assert.equal(nextCommercialAttemptAt(new Date("2026-08-15T00:00:00Z"), 1), "2026-08-15T00:01:00.000Z");
});
