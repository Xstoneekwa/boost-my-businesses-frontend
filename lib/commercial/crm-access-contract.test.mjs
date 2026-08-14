import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync(new URL("./crm-access.ts", import.meta.url), "utf8");

test("the server helper authenticates, requires superadmin, and reads the active explicit grant", () => {
  assert.match(helper, /getInstagramUserContext\(\)/);
  assert.match(helper, /internal_access_grants/);
  assert.match(helper, /COMMERCIAL_CRM_ACCESS_PERMISSION/);
  assert.match(helper, /\.eq\("active", true\)/);
  assert.match(helper, /\.is\("revoked_at", null\)/);
});

test("the helper has no identity hardcode, local bypass, frontend email check, or BotApp relay", () => {
  assert.doesNotMatch(helper, /580d7856-d60f-4838-a5f9-3b405d6ae79b/i);
  assert.doesNotMatch(helper, /NODE_ENV|LOCAL_ADMIN|bypass|headers\(|relay|botapp|email\s*[=!]==?/i);
});
