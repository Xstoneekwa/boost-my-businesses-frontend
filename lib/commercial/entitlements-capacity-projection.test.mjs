import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countLinkedInstagramAccountsForClient,
  countReservedEntitlementsForClient,
} from "./entitlements.ts";

function countClient(rowsByTable) {
  return {
    from(table) {
      const predicates = [];
      const query = {
        select() { return query; },
        eq(column, value) { predicates.push((row) => row[column] === value); return query; },
        is(column, value) { predicates.push((row) => row[column] === value); return query; },
        then(resolve, reject) {
          return Promise.resolve({
            count: (rowsByTable[table] ?? []).filter((row) => predicates.every((test) => test(row))).length,
            error: null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

describe("commercial capacity counting", () => {
  it("counts each unit once across reservation, binding, cancellation and replacement", async () => {
    const clientId = "client-a";
    const rows = {
      client_account_entitlements: [
        { client_id: clientId, status: "entitlement_reserved", account_id: null },
        { client_id: clientId, status: "entitlement_reserved", account_id: "bound-account" },
      ],
      client_instagram_accounts: [
        { client_id: clientId, active: true, capacity_status: "occupied" },
        { client_id: clientId, active: true, capacity_status: "released_terminal" },
      ],
    };
    const supabase = countClient(rows);

    assert.equal(await countReservedEntitlementsForClient(supabase, clientId), 1);
    assert.equal(await countLinkedInstagramAccountsForClient(supabase, clientId), 1);

    rows.client_account_entitlements[0].account_id = "replacement-account";
    rows.client_instagram_accounts.push({ client_id: clientId, active: true, capacity_status: "occupied" });
    assert.equal(await countReservedEntitlementsForClient(supabase, clientId), 0);
    assert.equal(await countLinkedInstagramAccountsForClient(supabase, clientId), 2);
  });

  it("keeps ownership-visible released links out of occupied capacity", async () => {
    const clientId = "client-a";
    const supabase = countClient({
      client_account_entitlements: [],
      client_instagram_accounts: [
        { client_id: clientId, active: true, capacity_status: "released_terminal" },
      ],
    });
    assert.equal(await countLinkedInstagramAccountsForClient(supabase, clientId), 0);
  });
});
