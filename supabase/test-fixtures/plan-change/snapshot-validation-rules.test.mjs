import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  containsLegitimateServiceRoleGrant,
  findForbiddenSecrets,
  auditExternalDependencies,
  auditManifestDependenciesDeclared,
} from "./snapshot-validation-rules.mjs";

describe("snapshot-validation-rules secrets", () => {
  it("accepts GRANT ... TO service_role", () => {
    const sql = "GRANT ALL ON TABLE public.clients TO service_role;";
    assert.deepEqual(findForbiddenSecrets(sql), []);
    assert.equal(containsLegitimateServiceRoleGrant(sql), true);
  });

  it("accepts GRANT to anon and authenticated role identifiers", () => {
    const sql = [
      "GRANT SELECT ON TABLE public.clients TO anon;",
      "REVOKE ALL ON TABLE public.clients FROM authenticated;",
    ].join("\n");
    assert.deepEqual(findForbiddenSecrets(sql), []);
  });

  it("refuses a real JWT-like key", () => {
    const sql =
      "SET app.settings = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.signature';";
    const violations = findForbiddenSecrets(sql);
    assert.ok(violations.some((v) => v.id === "jwt_like"));
  });

  it("refuses COPY and INSERT INTO", () => {
    assert.ok(findForbiddenSecrets("COPY public.clients FROM stdin;").some((v) => v.id === "copy"));
    assert.ok(findForbiddenSecrets("INSERT INTO public.clients VALUES (1);").some((v) => v.id === "insert"));
  });

  it("refuses postgres URL with password", () => {
    const sql = "-- bad: postgresql://postgres:secret@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres";
    assert.ok(
      findForbiddenSecrets(sql).some((v) => v.id === "postgresql_url_with_password")
    );
  });
});

describe("snapshot-validation-rules externalDependencies auditStatus", () => {
  it("auditStatus pending blocks before any catalogue inventory", () => {
    const issues = auditManifestDependenciesDeclared({
      auditStatus: "pending",
      extensions: null,
      schemas: ["auth"],
      functions: null,
      roles: null,
    });
    assert.ok(issues.some((i) => i.kind === "audit_pending"));
  });

  it("auditStatus partial blocks even when lists are populated", () => {
    const issues = auditManifestDependenciesDeclared({
      auditStatus: "partial",
      extensions: [],
      schemas: ["auth"],
      functions: ["set_updated_at"],
      roles: ["service_role"],
    });
    assert.ok(issues.some((i) => i.kind === "audit_partial"));
  });

  it("auditStatus complete accepts extensions: [] when snapshot has none", () => {
    const sql = "CREATE TABLE public.clients (id uuid primary key);";
    const manifestIssues = auditManifestDependenciesDeclared({
      auditStatus: "complete",
      extensions: [],
      schemas: [],
      functions: [],
      roles: [],
    });
    assert.deepEqual(manifestIssues, []);
    const depIssues = auditExternalDependencies(sql, {
      auditStatus: "complete",
      extensions: [],
      schemas: [],
      functions: [],
      roles: [],
    });
    assert.deepEqual(depIssues, []);
  });

  it("BLOCKED when snapshot references auth.* but schemas does not declare auth", () => {
    const sql = "CREATE TABLE public.tenant_users (user_id uuid references auth.users(id));";
    const issues = auditExternalDependencies(sql, {
      auditStatus: "complete",
      extensions: [],
      schemas: [],
      functions: [],
      roles: [],
    });
    assert.ok(issues.some((i) => i.kind === "undeclared_schema_reference" && i.name === "auth"));
  });

  it("BLOCKED when role declared but absent from snapshot GRANT/REVOKE", () => {
    const sql = "CREATE TABLE public.clients (id uuid primary key);";
    const issues = auditExternalDependencies(sql, {
      auditStatus: "complete",
      extensions: [],
      schemas: [],
      functions: [],
      roles: ["service_role"],
    });
    assert.ok(issues.some((i) => i.kind === "manifest_role_missing_in_snapshot" && i.name === "service_role"));
  });

  it("accepts declared role present in GRANT", () => {
    const sql = [
      "CREATE TABLE public.clients (id uuid primary key);",
      "GRANT ALL ON TABLE public.clients TO service_role;",
    ].join("\n");
    const issues = auditExternalDependencies(sql, {
      auditStatus: "complete",
      extensions: [],
      schemas: [],
      functions: [],
      roles: ["service_role"],
    });
    assert.deepEqual(issues, []);
  });
});
