import assert from "node:assert/strict";
import test from "node:test";

import { loadCanonicalActiveInstagramCredential } from "./canonical-active-instagram-credential.ts";

type Row = Record<string, unknown>;

function makeSupabase(rows: Row[]) {
  const filters: Array<(row: Row) => boolean> = [];
  let orderedField = "";
  let ascending = true;
  let limitValue = rows.length;
  const query = {
    select: () => query,
    eq: (field: string, value: unknown) => {
      filters.push((row) => row[field] === value);
      return query;
    },
    order: (field: string, options?: { ascending?: boolean }) => {
      orderedField = field;
      ascending = options?.ascending !== false;
      return query;
    },
    limit: (value: number) => {
      limitValue = value;
      const filtered = rows
        .filter((row) => filters.every((filter) => filter(row)))
        .sort((left, right) => {
          const a = Number(left[orderedField] ?? 0);
          const b = Number(right[orderedField] ?? 0);
          return ascending ? a - b : b - a;
        })
        .slice(0, limitValue);
      return Promise.resolve({ data: filtered, error: null });
    },
  };
  return {
    from(table: string) {
      assert.equal(table, "account_credentials");
      return query;
    },
  };
}

test("selects V3 active and ignores superseded Instagram history", async () => {
  const result = await loadCanonicalActiveInstagramCredential(makeSupabase([
    { account_id: "a1", provider: "instagram", status: "superseded", credentials_version: 1 },
    { account_id: "a1", provider: "instagram", status: "superseded", credentials_version: 2 },
    { account_id: "a1", provider: "instagram", status: "active", credentials_version: 3, reauth_required: true },
  ]), "a1");

  assert.equal(result.status, "selected");
  assert.equal(result.credential?.credentials_version, 3);
});

test("fails closed when multiple active Instagram credentials violate the invariant", async () => {
  const result = await loadCanonicalActiveInstagramCredential(makeSupabase([
    { account_id: "a1", provider: "instagram", status: "active", credentials_version: 2 },
    { account_id: "a1", provider: "instagram", status: "active", credentials_version: 3 },
  ]), "a1");

  assert.deepEqual(result, {
    status: "invariant_violation",
    credential: null,
    reason: "multiple_active_instagram_credentials",
  });
});

test("isolates providers and selects only the active Instagram credential", async () => {
  const result = await loadCanonicalActiveInstagramCredential(makeSupabase([
    { account_id: "a1", provider: "tiktok", status: "active", credentials_version: 9 },
    { account_id: "a1", provider: "instagram", status: "active", credentials_version: 1 },
  ]), "a1");

  assert.equal(result.status, "selected");
  assert.equal(result.credential?.provider, "instagram");
  assert.equal(result.credential?.credentials_version, 1);
});

test("reports missing when no active Instagram credential exists", async () => {
  const result = await loadCanonicalActiveInstagramCredential(makeSupabase([
    { account_id: "a1", provider: "instagram", status: "superseded", credentials_version: 3 },
    { account_id: "a1", provider: "tiktok", status: "active", credentials_version: 4 },
  ]), "a1");

  assert.deepEqual(result, { status: "missing", credential: null });
});

test("preserves the existing single V1 active account behavior", async () => {
  const result = await loadCanonicalActiveInstagramCredential(makeSupabase([
    { account_id: "legacy", provider: "instagram", status: "active", credentials_version: 1 },
  ]), "legacy");

  assert.equal(result.status, "selected");
  assert.equal(result.credential?.credentials_version, 1);
});
