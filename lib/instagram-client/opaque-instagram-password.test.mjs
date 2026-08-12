import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readOpaqueSecretString } from "./guards.ts";

const SYNTHETIC_PASSWORDS = [
  " password",
  "password ",
  " password ",
  "pa ss word",
  "mot-de-passe-é§🔐",
  "!@#$%^&*()_+-=[]{};':,.<>/?\\|`~",
];

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("opaque Instagram passwords preserve their exact character sequence", () => {
  for (const password of SYNTHETIC_PASSWORDS) {
    assert.equal(readOpaqueSecretString(password), password);
  }
});

test("opaque password reader accepts strings only and does not coerce values", () => {
  assert.equal(readOpaqueSecretString(""), "");
  assert.equal(readOpaqueSecretString(123456), "");
  assert.equal(readOpaqueSecretString(null), "");
});

test("all Instagram credential ingestion routes use the opaque reader", () => {
  const routes = [
    "../../app/api/instagram-client/onboarding/route.ts",
    "../../app/api/instagram-dashboard/accounts/create/route.ts",
    "../../app/api/instagram-dashboard/credentials/submit/route.ts",
  ];
  for (const route of routes) {
    const routeSource = source(route);
    assert.match(routeSource, /readOpaqueSecretString\([^\n]*password/);
    assert.doesNotMatch(routeSource, /readString\([^\n]*password/);
  }
  assert.doesNotMatch(source(routes[2]), /password\.trim\(\)/);
});

test("admin onboarding validates password presence without trimming the secret", () => {
  const wizardSource = source("../../app/instagram-dashboard/AddProfileWizard.tsx");
  assert.match(wizardSource, /form\.password\.length > 0/);
  assert.doesNotMatch(wizardSource, /form\.password\.trim\(\)/);
});

test("password values are not emitted to logs by ingestion routes", () => {
  for (const route of [
    "../../app/api/instagram-client/onboarding/route.ts",
    "../../app/api/instagram-dashboard/accounts/create/route.ts",
    "../../app/api/instagram-dashboard/credentials/submit/route.ts",
  ]) {
    assert.doesNotMatch(source(route), /console\.(?:log|info|warn|error)\([^\n]*password/i);
  }
});
