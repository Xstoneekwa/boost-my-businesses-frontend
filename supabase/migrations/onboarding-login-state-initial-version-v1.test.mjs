import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("./20260811005500_onboarding_login_state_initial_version_v1.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../rollback/20260811005500_onboarding_login_state_initial_version_v1.down.sql", import.meta.url), "utf8");

test("NEW_ACCOUNT_TEST_FLOW_STARTS_CANONICAL_ONBOARDING", () => {
  assert.match(migration, /client_instagram_accounts[\s\S]*login_state_version set default 1/i);
  assert.doesNotMatch(migration, /drop constraint|disable trigger/i);
});

test("future account links start at monotonic generation one", () => {
  assert.match(migration, /New account links start at generation 1/);
  assert.match(rollback, /login_state_version set default 0/i);
});

test("the correction is generic and does not create business records", () => {
  assert.doesNotMatch(migration, /nab_youss|84f559b7|01f56002|cf16af22/i);
  assert.doesNotMatch(migration, /insert\s+into|update\s+public|delete\s+from/i);
});
