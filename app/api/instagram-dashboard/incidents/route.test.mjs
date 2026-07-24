import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("incidents route is relay/admin protected and calls the canonical overview RPC", () => {
  assert.match(source, /requireRelayOrAdmin\(request, "Incidents"\)/);
  assert.match(source, /get_account_incidents_overview_v1/);
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE/);
});

test("incidents route distinguishes cursor, RPC and payload errors", () => {
  assert.match(source, /INCIDENTS_CURSOR_INVALID/);
  assert.match(source, /INCIDENTS_RPC_MISSING/);
  assert.match(source, /INCIDENTS_RPC_ERROR/);
  assert.match(source, /INCIDENTS_PAYLOAD_INVALID/);
});

test("incidents route exposes global counters and robust next-page metadata", () => {
  assert.match(source, /incidents_overview_v2/);
  assert.match(source, /filteredTotal/);
  assert.match(source, /nextCursor/);
  assert.match(source, /pageSize/);
  assert.match(source, /actionRequired/);
});
