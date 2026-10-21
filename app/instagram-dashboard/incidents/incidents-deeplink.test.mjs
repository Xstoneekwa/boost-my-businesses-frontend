import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("Admin incident deep-link accepts only canonical UUIDs and routes to exact detail", () => {
  assert.match(page, /const UUID = \/\^\[0-9a-f\]/);
  assert.match(page, /readParam\(params\.incident_id\)\.trim\(\)/);
  assert.match(page, /if \(UUID\.test\(requestedIncidentId\)\)/);
  assert.match(page, /redirect\(`\/instagram-dashboard\/incidents\/\$\{requestedIncidentId\}`\)/);
});

test("invalid incident_id falls through to the safe incident list", () => {
  const guard = page.indexOf("if (UUID.test(requestedIncidentId))");
  const list = page.lastIndexOf("getIncidentsOverview");
  assert.ok(guard >= 0 && list > guard);
});
