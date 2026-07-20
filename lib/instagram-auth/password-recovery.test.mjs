import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";

const helperSource = readFileSync(new URL("./password-recovery.ts", import.meta.url), "utf8");
const helperJavaScript = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const recovery = await import(`data:text/javascript;base64,${Buffer.from(helperJavaScript).toString("base64")}`);

const {
  buildInstagramPasswordResetRedirect,
  isPasswordRecoveryAuthEvent,
} = recovery;

const loginSource = readFileSync(new URL("../../app/instagram-login/InstagramLoginClient.tsx", import.meta.url), "utf8");
const forgotSource = readFileSync(new URL("../../app/instagram-forgot-password/page.tsx", import.meta.url), "utf8");
const resetSource = readFileSync(new URL("../../app/instagram-reset-password/page.tsx", import.meta.url), "utf8");

describe("Instagram password recovery", () => {
  it("uses the exact production reset URL outside local development", () => {
    assert.equal(
      buildInstagramPasswordResetRedirect("https://preview.example", "production"),
      "https://www.boostmybusinesses.com/instagram-reset-password",
    );
    assert.equal(
      buildInstagramPasswordResetRedirect("http://localhost:3000", "production"),
      "https://www.boostmybusinesses.com/instagram-reset-password",
    );
  });

  it("keeps a localhost callback only in development", () => {
    assert.equal(
      buildInstagramPasswordResetRedirect("http://localhost:3000", "development"),
      "http://localhost:3000/instagram-reset-password",
    );
  });

  it("accepts only a PASSWORD_RECOVERY event with a session", () => {
    assert.equal(isPasswordRecoveryAuthEvent("PASSWORD_RECOVERY", true), true);
    assert.equal(isPasswordRecoveryAuthEvent("SIGNED_IN", true), false);
    assert.equal(isPasswordRecoveryAuthEvent("PASSWORD_RECOVERY", false), false);
  });

  it("routes Instagram Forgot Password through the dedicated flow", () => {
    assert.match(loginSource, /href="\/instagram-forgot-password"/);
    assert.doesNotMatch(loginSource, /restaurant-forgot-password/);
    assert.match(forgotSource, /resetPasswordForEmail\(canonicalEmail/);
    assert.match(forgotSource, /buildInstagramPasswordResetRedirect\(window\.location\.origin\)/);
  });

  it("updates the password only after recovery and removes the local recovery session", () => {
    assert.match(resetSource, /onAuthStateChange/);
    assert.match(resetSource, /isPasswordRecoveryAuthEvent\(event, Boolean\(session\)\)/);
    assert.match(resetSource, /recoveryState !== "ready"/);
    assert.match(resetSource, /updateUser\(\{ password: newPassword \}\)/);
    assert.match(resetSource, /signOut\(\{ scope: "local" \}\)/);
    assert.match(resetSource, /router\.replace\("\/instagram-login"\)/);
    assert.doesNotMatch(resetSource, /console\.(?:log|debug|info|warn|error)/);
    assert.doesNotMatch(resetSource, /window\.location\.(?:hash|href)/);
  });
});
