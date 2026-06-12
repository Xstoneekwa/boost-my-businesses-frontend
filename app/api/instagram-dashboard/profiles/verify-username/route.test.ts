import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("BotApp username verify uses relay auth and backend public profile lookup", () => {
  assert.match(source, /verifyCompassRelayKey/);
  assert.match(source, /requireInstagramAdmin/);
  assert.match(source, /lookupInstagramPublicProfile/);
  assert.match(source, /botapp_add_profile/);
});

test("BotApp username verify returns safe provider statuses without raw avatar", () => {
  assert.match(source, /provider_not_configured/);
  assert.match(source, /not_found/);
  assert.match(source, /avatar_url: null/);
  assert.doesNotMatch(source, /api_key|INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY|SearchAPI/i);
});
