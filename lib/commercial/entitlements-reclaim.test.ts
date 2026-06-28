import assert from "node:assert/strict";
import test from "node:test";

import { getReservedEntitlementForClient } from "./entitlements.ts";

type Row = Record<string, unknown>;

function makeSupabase(rows: Row[]) {
  return {
    from(table: string) {
      if (table !== "client_account_entitlements") throw new Error(`unexpected table ${table}`);
      const filters: Array<(row: Row) => boolean> = [];
      let updatePayload: Row | null = null;
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => {
          filters.push((row) => row[field] === value);
          return query;
        },
        is: (field: string, value: null) => {
          filters.push((row) => (value === null ? row[field] == null : row[field] === value));
          return query;
        },
        order: () => query,
        limit: () => query,
        update: (payload: Row) => {
          updatePayload = payload;
          return query;
        },
        maybeSingle: async () => {
          const matches = rows.filter((row) => filters.every((filter) => filter(row)));
          if (updatePayload) {
            const target = matches[0];
            if (!target) return { data: null, error: null };
            Object.assign(target, updatePayload);
            return { data: target, error: null };
          }
          return { data: matches[0] ?? null, error: null };
        },
      };
      return query;
    },
  };
}

test("getReservedEntitlementForClient returns active reserved row first", async () => {
  const supabase = makeSupabase([
    {
      id: "ent-reserved",
      client_id: "client-1",
      status: "entitlement_reserved",
      account_id: null,
      checkout_session_id: "sess-1",
      plan_key: "growth",
      commercial_package_code: "growth",
      billing_interval_months: 1,
      created_at: "2026-06-28T18:43:07Z",
      updated_at: "2026-06-28T18:43:07Z",
    },
  ]);
  const row = await getReservedEntitlementForClient(supabase as never, "client-1");
  assert.equal(row?.id, "ent-reserved");
  assert.equal(row?.status, "entitlement_reserved");
});

test("getReservedEntitlementForClient reclaims consumed slot with null account", async () => {
  const rows: Row[] = [
    {
      id: "ent-growth",
      client_id: "client-1",
      status: "entitlement_consumed",
      account_id: "acct-1",
      checkout_session_id: "sess-1",
      plan_key: "growth",
      commercial_package_code: "growth",
      billing_interval_months: 1,
      created_at: "2026-06-28T18:43:07Z",
      updated_at: "2026-06-28T18:43:07Z",
    },
    {
      id: "ent-pro",
      client_id: "client-1",
      status: "entitlement_consumed",
      account_id: null,
      checkout_session_id: "sess-2",
      plan_key: "pro",
      commercial_package_code: "pro",
      billing_interval_months: 1,
      created_at: "2026-06-28T19:14:02Z",
      updated_at: "2026-06-28T19:14:02Z",
    },
  ];
  const supabase = makeSupabase(rows);
  const row = await getReservedEntitlementForClient(supabase as never, "client-1");
  assert.equal(row?.id, "ent-pro");
  assert.equal(row?.status, "entitlement_reserved");
  assert.equal(row?.consumedAt, null);
});
