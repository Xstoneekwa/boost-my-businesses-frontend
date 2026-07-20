import assert from "node:assert/strict";
import { describe, it } from "node:test";
import recovery from "./client-auth-recovery.ts";

const {
  buildClientPasswordResetRedirect,
  normalizeClientLoginReturnPath,
} = recovery;

describe("client password recovery handoff", () => {
  it("returns Growth clients to the Instagram login", () => {
    assert.equal(normalizeClientLoginReturnPath("/instagram-login"), "/instagram-login");
    assert.equal(
      buildClientPasswordResetRedirect("https://www.boostmybusinesses.com", "/instagram-login"),
      "https://www.boostmybusinesses.com/restaurant-reset-password?returnTo=%2Finstagram-login",
    );
  });

  it("rejects external and unknown return destinations", () => {
    assert.equal(normalizeClientLoginReturnPath("https://evil.example/steal"), "/restaurant-login");
    assert.equal(normalizeClientLoginReturnPath("//evil.example"), "/restaurant-login");
    assert.equal(normalizeClientLoginReturnPath("/admin"), "/restaurant-login");
    assert.equal(normalizeClientLoginReturnPath(null), "/restaurant-login");
  });
});
