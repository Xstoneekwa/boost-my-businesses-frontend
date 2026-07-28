import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/auto-restart/settings/route.ts", import.meta.url),
  "utf8",
);
const settingsHelpers = readFileSync(
  new URL("../../app/api/instagram-dashboard/auto-restart/settings/helpers.ts", import.meta.url),
  "utf8",
);
const tick = readFileSync(new URL("./auto-restart-tick.ts", import.meta.url), "utf8");
const data = readFileSync(
  new URL("../../app/instagram-dashboard/auto-restart-data.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../../supabase/migrations/20260710120000_auto_restart_settings.sql", import.meta.url),
  "utf8",
);

test("Scheduler restart delay is one global singleton edited by BotApp", () => {
  assert.match(migration, /constraint auto_restart_settings_id_check check \(id = 'global'\)/);
  assert.match(settingsRoute, /\.eq\("id", "global"\)/);
  assert.match(settingsHelpers, /restart_delay_minutes: readPositiveInt\(body\.restart_delay_minutes/);
  assert.match(settingsRoute, /\.upsert\(\{[\s\S]*id: "global"/);
});

test("every natural tick reloads the global delay and applies it to candidates", () => {
  assert.match(tick, /const settingsRow = await loadSettingsRow\(supabase\)/);
  assert.match(tick, /settingsRow\?\.restart_delay_minutes/);
  assert.match(data, /rules\.restartDelayMinutes \* 60_000/);
  assert.doesNotMatch(data, /resumePlan\?\.restart_delay_minutes/);
});
