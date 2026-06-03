import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("avatar proxy reads only persisted safe avatar fields", () => {
  assert.match(source, /from\("ig_accounts"\)/);
  assert.match(source, /from\("ig_targets"\)/);
  assert.match(source, /select\("avatar_url"\)/);
  assert.doesNotMatch(source, /password/);
  assert.doesNotMatch(source, /secret_ref/);
});

test("avatar proxy fetches server-side and returns image content only", () => {
  assert.match(source, /fetch\(avatarUrl/);
  assert.match(source, /allowedImageTypes/);
  assert.match(source, /Content-Type/);
  assert.match(source, /Cache-Control/);
});
