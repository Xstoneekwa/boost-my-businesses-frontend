import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../app/instagram-client/ClientDashboard.tsx", import.meta.url),
  "utf8",
);

test("account progress modal uses the canonical account-scoped connect endpoint", () => {
  assert.match(source, /api\/instagram-client\/accounts\/\$\{encodeURIComponent\(scopedAccountId\)\}\/connect\/progress/);
  assert.doesNotMatch(source, /instagram-dashboard\/runs\/progress\?account_id=\$\{encodeURIComponent\(scopedAccountId\)\}/);
});

test("progress polling pins the first request lineage through terminalization", () => {
  assert.match(source, /if \(correlatedRequestId\) params\.set\("request_id", correlatedRequestId\)/);
  assert.match(source, /requestId: payload\.data\?\.request_id \|\| current\.requestId/);
});

test("manual recheck refreshes the same correlated operation", () => {
  assert.match(source, /refreshVersion: current\.refreshVersion \+ 1/);
  assert.match(source, /connectProgress\?\.refreshVersion/);
});

test("client modal renders canonical terminal and verification outcomes", () => {
  assert.match(source, /snapshot\.connect_status === "verification_required"/);
  assert.match(source, /snapshot\.connect_status === "connected"/);
  assert.match(source, /snapshot\.connect_status === "failed" \|\| snapshot\.connect_status === "blocked"/);
});
