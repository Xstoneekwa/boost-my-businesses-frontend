import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PUBLIC_SCHEMA,
  classifyTableProbeResponse,
  createPlanChangeAdminClient,
  formatInventoryProbeStatus,
  formatProbeLog,
  fromPublicTable,
  fromSchemaTable,
  normalizeTableName,
  resolvePublicTable,
} from "./plan-change-rest-probe.mjs";

describe("plan-change-rest-probe", () => {
  it("normalizeTableName accepts bare table names", () => {
    assert.equal(normalizeTableName("clients"), "clients");
    assert.equal(normalizeTableName("commercial_checkout_sessions"), "commercial_checkout_sessions");
  });

  it("normalizeTableName strips public. prefix instead of using it as literal table", () => {
    assert.equal(normalizeTableName("public.clients"), "clients");
  });

  it("normalizeTableName rejects other qualified names", () => {
    assert.throws(() => normalizeTableName("supabase_migrations.schema_migrations"), /not allowed/);
    assert.throws(() => normalizeTableName("public.clients.extra"), /not allowed/);
  });

  it("resolvePublicTable never uses public.clients as table field", () => {
    const ref = resolvePublicTable("clients");
    assert.equal(ref.schema, PUBLIC_SCHEMA);
    assert.equal(ref.table, "clients");
    assert.notEqual(ref.table, "public.clients");
    assert.match(ref.probeLabel, /schema=public table=clients/);
  });

  it("fromPublicTable uses schema(public).from(clients) not from(public.clients)", () => {
    const schemaCalls = [];
    const fromCalls = [];
    const mockClient = {
      schema(schema) {
        schemaCalls.push(schema);
        return {
          from(table) {
            fromCalls.push(table);
            return { __query: true };
          },
        };
      },
    };

    const { query, ref } = fromPublicTable(mockClient, "clients");
    assert.equal(query.__query, true);
    assert.deepEqual(schemaCalls, ["public"]);
    assert.deepEqual(fromCalls, ["clients"]);
    assert.equal(ref.table, "clients");
    assert.ok(!fromCalls.includes("public.clients"));
  });

  it("fromPublicTable normalizes public.clients input to bare clients", () => {
    const fromCalls = [];
    const mockClient = {
      schema() {
        return {
          from(table) {
            fromCalls.push(table);
            return {};
          },
        };
      },
    };
    fromPublicTable(mockClient, "public.clients");
    assert.deepEqual(fromCalls, ["clients"]);
  });

  it("fromSchemaTable keeps non-public schemas explicit", () => {
    const schemaCalls = [];
    const fromCalls = [];
    const mockClient = {
      schema(schema) {
        schemaCalls.push(schema);
        return {
          from(table) {
            fromCalls.push(table);
            return {};
          },
        };
      },
    };
    fromSchemaTable(mockClient, "supabase_migrations", "schema_migrations");
    assert.deepEqual(schemaCalls, ["supabase_migrations"]);
    assert.deepEqual(fromCalls, ["schema_migrations"]);
  });

  it("formatProbeLog includes schema and table without secrets", () => {
    const line = formatProbeLog("inventory", resolvePublicTable("clients"));
    assert.equal(line, "probe type=inventory schema=public table=clients");
    assert.ok(!line.includes("http"));
    assert.ok(!line.includes("Bearer"));
  });

  it("createPlanChangeAdminClient returns a Supabase client", () => {
    const client = createPlanChangeAdminClient("https://example.supabase.co", "test-key");
    assert.equal(typeof client.schema, "function");
    assert.equal(typeof client.from, "function");
  });

  describe("classifyTableProbeResponse", () => {
    it("marks exists only when head and verify both succeed with numeric count", () => {
      const result = classifyTableProbeResponse({ error: null, count: 0 }, { error: null });
      assert.equal(result.state, "exists");
      assert.equal(result.count, 0);
    });

    it("marks missing when verify select fails with table-not-found even if head count looked empty", () => {
      const result = classifyTableProbeResponse(
        { error: null, count: 0 },
        { error: { message: "Could not find the table 'public.clients' in the schema cache" } }
      );
      assert.equal(result.state, "missing");
      assert.equal(result.count, null);
    });

    it("marks missing when head fails with schema cache error", () => {
      const result = classifyTableProbeResponse(
        { error: { message: "Could not find the table 'clients' in the schema cache" } },
        { error: null }
      );
      assert.equal(result.state, "missing");
      assert.equal(result.count, null);
    });

    it("never returns exists without numeric exact count", () => {
      const result = classifyTableProbeResponse({ error: null, count: null }, { error: null });
      assert.equal(result.state, "inaccessible");
      assert.equal(result.count, null);
    });

    it("formatInventoryProbeStatus never shows rows=0 for missing tables", () => {
      const ref = resolvePublicTable("clients");
      const missing = formatInventoryProbeStatus({
        state: "missing",
        count: null,
        error: "Could not find the table",
        ref,
      });
      assert.match(missing, /^missing /);
      assert.ok(!missing.includes("rows=0"));

      const exists = formatInventoryProbeStatus({
        state: "exists",
        count: 0,
        error: null,
        ref,
      });
      assert.match(exists, /^exists rows=0 /);
    });
  });
});
