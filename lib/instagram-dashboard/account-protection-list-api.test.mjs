import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  accountProtectionListEtag,
  accountProtectionMutationBlocked,
  buildAccountProtectionListSnapshot,
  normalizeProtectionPatch,
  normalizeProtectionUsername,
  normalizeProtectionUsernameEntries,
  readExpectedVersion,
} from "./account-protection-list-contract.ts";

const accountId = "10000000-0000-4000-8000-000000000001";
const kind = "interaction_blacklist";
const migration = await readFile(new URL("../../supabase/migrations/20260726041500_account_protection_lists_v1.sql", import.meta.url), "utf8");
const service = await readFile(new URL("./account-protection-list-service.ts", import.meta.url), "utf8");
const clientRoute = await readFile(new URL("../../app/api/instagram-client/accounts/[accountId]/protection-lists/[listKind]/route.ts", import.meta.url), "utf8");
const adminRoute = await readFile(new URL("../../app/api/instagram-dashboard/accounts/[accountId]/protection-lists/[listKind]/route.ts", import.meta.url), "utf8");

test("GET empty list contract", () => {
  assert.deepEqual(buildAccountProtectionListSnapshot([], 0, null), {
    items: [], size: 0, version: 0, updatedAt: null, status: "loaded_empty",
  });
});

test("GET populated list contract", () => {
  const snapshot = buildAccountProtectionListSnapshot(["beta", "alpha"], 2, "2026-07-26T00:00:00Z");
  assert.deepEqual(snapshot.items, ["alpha", "beta"]);
  assert.equal(snapshot.status, "loaded_with_items");
});

test("add simple normalizes username", () => {
  assert.deepEqual(normalizeProtectionPatch([" @Alpha "], []), { add: ["alpha"], remove: [], errors: [] });
});

test("add multiple normalizes and sorts", () => {
  assert.deepEqual(normalizeProtectionPatch(["Zulu", "alpha"], []).add, ["alpha", "zulu"]);
});

test("remove normalizes username", () => {
  assert.deepEqual(normalizeProtectionPatch([], ["@Alpha"]).remove, ["alpha"]);
});

test("replace accepts a complete normalized array", () => {
  assert.deepEqual(normalizeProtectionUsernameEntries(["Two", "one"], "items").items, ["one", "two"]);
  assert.match(migration, /p_operation = 'replace'/);
});

test("duplicate input is reported instead of dropped", () => {
  const result = normalizeProtectionUsernameEntries(["Alpha", "@alpha"], "items");
  assert.equal(result.errors[0].code, "duplicate_input");
});

test("invalid entry returns detailed codes", () => {
  const result = normalizeProtectionUsernameEntries(["", "https://instagram.com/user", "bad name"], "items");
  assert.deepEqual(result.errors.map((error) => error.code), ["empty_username", "instagram_url_not_allowed", "invalid_username"]);
});

test("idempotency retry is keyed and fingerprint-checked", () => {
  assert.match(migration, /account_protection_list_events_idempotency_idx/);
  assert.match(migration, /request_fingerprint/);
  assert.match(service, /idempotencyKey/);
});

test("If-Match correct exposes expected version", () => {
  const etag = accountProtectionListEtag(accountId, kind, 7);
  assert.deepEqual(readExpectedVersion(etag, accountId, kind), { ok: true, version: 7 });
});

test("If-Match conflict is mapped to 409", () => {
  assert.match(service, /AccountProtectionListServiceError\(409, code/);
  assert.equal(readExpectedVersion('"apl:wrong:v2"', accountId, kind).ok, false);
});

test("owner authorization uses canonical account ownership", () => {
  assert.match(clientRoute, /authorizeClientInstagramAccount/);
});

test("different tenant is refused by the ownership gate", () => {
  assert.match(clientRoute, /ownership\.status/);
  assert.match(clientRoute, /ownership\.error/);
});

test("admin uses canonical admin authorization", () => {
  assert.match(adminRoute, /requireInstagramAdmin/);
  assert.match(adminRoute, /sourceSurface: "admin_dashboard"/);
});

test("unauthenticated client is refused", () => {
  assert.match(clientRoute, /requireClientInstagramSession/);
  assert.match(clientRoute, /session\.status/);
});

test("archived mutation is refused", () => {
  assert.equal(accountProtectionMutationBlocked({ archived_at: "2026-07-26T00:00:00Z" }), true);
});

test("trashed mutation is refused", () => {
  assert.equal(accountProtectionMutationBlocked({ trashed_at: "2026-07-26T00:00:00Z" }), true);
  assert.equal(accountProtectionMutationBlocked({ status: "paused", admin_lifecycle_status: "paused" }), false);
});

test("version increments only for a changed representation", () => {
  assert.match(migration, /v_new_version := v_current_version \+ case when v_changed then 1 else 0 end/);
});

test("every accepted mutation creates one audit event", () => {
  assert.match(migration, /insert into public\.account_protection_list_events/);
  assert.match(migration, /previous_version,[\s\S]*new_version/);
});

test("audit metadata never stores a complete list", () => {
  const metadataBlock = migration.match(/jsonb_build_object\(\n\+?\s*'operation'[\s\S]*?'request_fingerprint', p_request_fingerprint\n\+?\s*\)/)?.[0] ?? "";
  assert.doesNotMatch(metadataBlock, /to_jsonb\(p_|'items'\s*,\s*p_|'list'\s*,\s*p_/);
  assert.match(metadataBlock, /item_count/);
  assert.equal(normalizeProtectionUsername("https://instagram.com/not-logged").code, "instagram_url_not_allowed");
});
