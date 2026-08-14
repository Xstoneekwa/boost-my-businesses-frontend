import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./crm-access-policy.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const { evaluateCommercialCrmAccess } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const cases = [
  {
    label: "unauthenticated",
    input: { authenticated: false, role: null, grantLookupSucceeded: true, hasActiveGrant: false },
    expected: { allowed: false, status: 401, code: "commercial_crm_authentication_required" },
  },
  {
    label: "client or tenant user",
    input: { authenticated: true, role: "tenant", grantLookupSucceeded: true, hasActiveGrant: true },
    expected: { allowed: false, status: 403, code: "commercial_crm_superadmin_required" },
  },
  {
    label: "ordinary admin equivalent",
    input: { authenticated: true, role: "admin", grantLookupSucceeded: true, hasActiveGrant: true },
    expected: { allowed: false, status: 403, code: "commercial_crm_superadmin_required" },
  },
  {
    label: "superadmin without grant",
    input: { authenticated: true, role: "superadmin", grantLookupSucceeded: true, hasActiveGrant: false },
    expected: { allowed: false, status: 403, code: "commercial_crm_access_grant_required" },
  },
  {
    label: "Liam or explicitly delegated superadmin with active grant",
    input: { authenticated: true, role: "superadmin", grantLookupSucceeded: true, hasActiveGrant: true },
    expected: { allowed: true },
  },
  {
    label: "revoked grant",
    input: { authenticated: true, role: "superadmin", grantLookupSucceeded: true, hasActiveGrant: false },
    expected: { allowed: false, status: 403, code: "commercial_crm_access_grant_required" },
  },
  {
    label: "grant database unavailable fails closed",
    input: { authenticated: true, role: "superadmin", grantLookupSucceeded: false, hasActiveGrant: true },
    expected: { allowed: false, status: 503, code: "commercial_crm_access_check_unavailable" },
  },
];

for (const accessCase of cases) {
  test(`Commercial CRM access matrix: ${accessCase.label}`, () => {
    assert.deepEqual(evaluateCommercialCrmAccess(accessCase.input), accessCase.expected);
  });
}
