import assert from "node:assert/strict";
import test from "node:test";
import { instagramPostLoginPath } from "./post-login-path.ts";

test("instagramPostLoginPath sends superadmin to admin dashboard", () => {
  assert.equal(instagramPostLoginPath("superadmin"), "/instagram-dashboard");
});

test("instagramPostLoginPath sends tenant clients to client dashboard", () => {
  assert.equal(instagramPostLoginPath("tenant"), "/instagram-client");
});

test("instagramPostLoginPath defaults unknown roles to client dashboard", () => {
  assert.equal(instagramPostLoginPath(null), "/instagram-client");
  assert.equal(instagramPostLoginPath(undefined), "/instagram-client");
});
