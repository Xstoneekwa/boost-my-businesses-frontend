import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const listRoute = readFileSync(
  new URL("./route.ts", import.meta.url),
  "utf8",
);
const detailRoute = readFileSync(
  new URL("./[intentId]/route.ts", import.meta.url),
  "utf8",
);

test("email history list route is read-only relay", () => {
  assert.match(listRoute, /requireRelayOrAdmin/);
  assert.match(listRoute, /loadClientEmailHistoryProjection/);
  assert.doesNotMatch(listRoute, /POST|PATCH|PUT|DELETE/);
});

test("email history detail route returns unavailable state safely", () => {
  assert.match(detailRoute, /feature_unavailable/);
  assert.match(detailRoute, /loadClientEmailHistoryDetail/);
});
