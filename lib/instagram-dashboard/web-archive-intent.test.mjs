import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clearWebArchiveIntent, prepareWebArchiveIntent } from "./web-archive-intent.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function memoryStorage() {
  const rows = new Map();
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
    removeItem: (key) => rows.delete(key),
  };
}

test("confirmed archive intent is UUID v4 and stable across retry/reload", () => {
  const storage = memoryStorage();
  let generated = 0;
  const createUuid = () => (++generated === 1 ? UUID_A : UUID_B);
  const first = prepareWebArchiveIntent(storage, "admin", " account ", ["b", "a", "a"], createUuid);
  const retry = prepareWebArchiveIntent(storage, "admin", "account", ["a", "b"], createUuid);
  assert.equal(first.archiveIntentId, UUID_A);
  assert.deepEqual(first.ids, ["a", "b"]);
  assert.deepEqual(retry, first);
  assert.equal(generated, 1);
});

test("successful completion clears only the exact surface/account/target intent", () => {
  const storage = memoryStorage();
  const admin = prepareWebArchiveIntent(storage, "admin", "account", ["a"], () => UUID_A);
  const client = prepareWebArchiveIntent(storage, "client", "account", ["a"], () => UUID_B);
  clearWebArchiveIntent(storage, admin);
  const clientRetry = prepareWebArchiveIntent(storage, "client", "account", ["a"], () => UUID_A);
  const adminNext = prepareWebArchiveIntent(storage, "admin", "account", ["a"], () => UUID_B);
  assert.equal(clientRetry.archiveIntentId, UUID_B);
  assert.equal(adminNext.archiveIntentId, UUID_B);
});

test("Admin and Client callers transport the confirmed intent and clear only after success", () => {
  const admin = readFileSync(new URL("../../app/instagram-dashboard/InstagramAccountTargetsPanel.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../../app/instagram-client/ClientAccountTargetsDrawer.tsx", import.meta.url), "utf8");
  for (const source of [admin, client]) {
    assert.match(source, /prepareWebArchiveIntent\(/);
    assert.match(source, /archive_intent_id:\s*archiveIntent\.archiveIntentId/);
    assert.match(source, /clearWebArchiveIntent\(window\.localStorage, archiveIntent\)/);
  }
  assert.match(client, /window\.confirm\(/);
});
