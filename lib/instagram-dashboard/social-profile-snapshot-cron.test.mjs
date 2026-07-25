import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../../app/api/cron/instagram-follower-snapshots/route.ts", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));

test("daily collector uses canonical Vercel CRON_SECRET Bearer auth before work", () => {
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /authorization.*Bearer/si);
  assert.ok(route.indexOf("const cronSecret") < route.indexOf("enqueueDailySocialProfileSnapshotJobs({})"));
  assert.doesNotMatch(route, /ADB|uiautomator|account_run_requests|ig_runs/);
});

test("collector is registered daily at 02:15 UTC", () => {
  const entry = vercel.crons.find((cron) => cron.path === "/api/cron/instagram-follower-snapshots");
  assert.deepEqual(entry, {
    path: "/api/cron/instagram-follower-snapshots",
    schedule: "15 2 * * *",
  });
});

test("wrong or absent token is rejected before dry-run or mutation paths", () => {
  const authIndex = route.indexOf("return NextResponse.json({ ok: false, error: \"Unauthorized\" }");
  assert.ok(authIndex > 0);
  assert.ok(authIndex < route.indexOf("dry_run"));
  assert.ok(authIndex < route.indexOf("enqueueDailySocialProfileSnapshotJobs({})"));
});

test("cron responses never expose internal provider or database errors", () => {
  assert.doesNotMatch(route, /error instanceof Error/);
  assert.doesNotMatch(route, /error\.message/);
  assert.match(route, /follower_snapshot_dry_run_failed/);
  assert.match(route, /follower_snapshot_cron_failed/);
});
