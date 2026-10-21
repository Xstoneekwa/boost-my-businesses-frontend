import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const route = fs.readFileSync(new URL("../app/api/cron/target-evidence-revalidation/route.ts", import.meta.url), "utf8");
const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

test("Vercel GET cron is registered once at the bounded five-minute cadence", () => {
  const matches = vercel.crons.filter((entry) => entry.path === "/api/cron/target-evidence-revalidation");
  assert.deepEqual(matches, [{
    path: "/api/cron/target-evidence-revalidation",
    schedule: "*/5 * * * *",
  }]);
});

test("cron route is structurally evidence-only and non-authoritative", () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /processorMode:\s*"evidence_only"/);
  assert.match(route, /business_requalification:\s*false/);
  assert.match(route, /enforcement:\s*false/);
  for (const forbidden of ["archive", "replacement", "pool_eligibility", "device", "adb"]) {
    assert.equal(route.toLowerCase().includes(forbidden), false, `forbidden route coupling: ${forbidden}`);
  }
});
