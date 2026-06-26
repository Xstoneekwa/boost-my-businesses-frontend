import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  loadCanonicalIgAccountUsername,
  sanitizeClientApiError,
} from "./client-account-canonical.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("sanitizeClientApiError hides postgres and missing column messages", () => {
  assert.equal(
    sanitizeClientApiError("column client_instagram_accounts.username does not exist", "Safe fallback"),
    "Safe fallback",
  );
  assert.equal(
    sanitizeClientApiError("relation ig_accounts does not exist", "Safe fallback"),
    "Safe fallback",
  );
  assert.equal(
    sanitizeClientApiError("Invalid template body.", "Safe fallback"),
    "Invalid template body.",
  );
});

test("loadCanonicalIgAccountUsername reads ig_accounts not client_instagram_accounts", () => {
  const canonicalSource = source("./client-account-canonical.ts");
  const dmRoute = source("../../app/api/instagram-client/accounts/[accountId]/dm-templates/route.ts");
  const welcomeRoute = source("../../app/api/instagram-client/accounts/[accountId]/dm-templates/welcome/route.ts");
  const outreachRoute = source("../../app/api/instagram-client/accounts/[accountId]/dm-templates/outreach/route.ts");
  const loaderSource = source("./client-dm-templates.ts");

  assert.match(canonicalSource, /from\("ig_accounts"\)/);
  assert.doesNotMatch(canonicalSource, /client_instagram_accounts\.username/);
  assert.doesNotMatch(dmRoute, /client_instagram_accounts.*username/);
  assert.doesNotMatch(welcomeRoute, /client_instagram_accounts.*username/);
  assert.doesNotMatch(outreachRoute, /client_instagram_accounts.*username/);
  assert.match(loaderSource, /loadCanonicalIgAccountUsername/);
});

test("loadCanonicalIgAccountUsername short-circuits empty account ids", async () => {
  const result = await loadCanonicalIgAccountUsername(null, "   ");
  assert.equal(result, null);
});
