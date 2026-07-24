import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const LOGIN_PREFLIGHT_CRON_PATH = "/api/instagram-dashboard/login-preflight/cron";
const LOGIN_PREFLIGHT_CRON_SCHEDULE = "*/5 * * * *";

test("vercel.json registers exactly one T-10 login preflight cron", () => {
  const vercelJson = readFileSync(
    fileURLToPath(new URL("../../vercel.json", import.meta.url)),
    "utf8",
  );
  const parsed = JSON.parse(vercelJson) as { crons?: Array<{ path?: string; schedule?: string }> };
  const preflightCrons = (parsed.crons ?? []).filter((cron) => cron.path === LOGIN_PREFLIGHT_CRON_PATH);

  assert.equal(preflightCrons.length, 1);
  assert.equal(preflightCrons[0]?.schedule, LOGIN_PREFLIGHT_CRON_SCHEDULE);
});
