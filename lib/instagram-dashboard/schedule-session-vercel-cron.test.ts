import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const vercel = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../vercel.json", import.meta.url)), "utf8"),
) as { crons?: Array<{ path?: string; schedule?: string }> };

test("scheduled account sessions are evaluated every minute", () => {
  const entries = (vercel.crons ?? []).filter(
    (entry) => entry.path === "/api/instagram-dashboard/schedule-session/cron",
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.schedule, "* * * * *");
});
