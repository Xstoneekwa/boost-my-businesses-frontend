import assert from "node:assert/strict";
import test from "node:test";
import { CLIENT_EMAIL_TEST_DELIVERY_LABEL } from "./client-email-constants.ts";
import {
  executeClientEmailTestDelivery,
  loadClientEmailTestDeliveryStatus,
} from "./client-email-test-delivery.ts";

type Row = Record<string, unknown>;

function createMockSupabase(input: {
  templates?: Row[];
  intents?: Row[];
  events?: Row[];
  testSchemaReady?: boolean;
  infrastructureReady?: boolean;
}) {
  const templates = [...(input.templates ?? [])];
  const intents = [...(input.intents ?? [])];
  const events = [...(input.events ?? [])];
  const testSchemaReady = input.testSchemaReady !== false;
  const infrastructureReady = input.infrastructureReady !== false;

  const MISSING_TABLE = {
    message: "Could not find the table 'public.client_email_templates' in the schema cache",
    code: "PGRST205",
  };
  const MISSING_INTENT_KIND = {
    message: "column client_email_send_intents.intent_kind does not exist",
    code: "42703",
  };

  function filter(table: string, filters: Array<{ column: string; op: string; value: unknown }>) {
    const source = table === "client_email_templates" ? templates
      : table === "client_email_send_intents" ? intents
        : table === "client_email_delivery_events" ? events
          : [];
    return source.filter((row) => filters.every((filter) => {
      if (filter.op === "eq") return row[filter.column] === filter.value;
      if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
      return true;
    }));
  }

  function makeQuery(table: string) {
    const state = {
      filters: [] as Array<{ column: string; op: string; value: unknown }>,
      insertValues: null as Row | null,
      updateValues: null as Row | null,
      updateId: null as string | null,
      selectColumns: "*",
      limitValue: 100,
      mode: "select" as "select" | "insert" | "update",
    };

    const api = {
      select(columns?: string) {
        state.selectColumns = columns ?? "*";
        if (state.mode === "insert") return api;
        state.mode = "select";
        return api;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ column, op: "eq", value });
        if (state.mode === "update") state.updateId = String(value ?? "");
        return api;
      },
      in(column: string, value: unknown[]) {
        state.filters.push({ column, op: "in", value });
        return api;
      },
      limit(count: number) {
        state.limitValue = count;
        return api;
      },
      insert(values: Row) {
        state.mode = "insert";
        state.insertValues = values;
        const duplicate = intents.some((row) => row.idempotency_key === values.idempotency_key);
        if (duplicate) {
          return {
            select: () => ({
              maybeSingle: async () => ({ data: null, error: { message: "duplicate key value violates unique constraint" } }),
            }),
          };
        }
        const id = values.id ?? `intent-${intents.length + 1}`;
        intents.push({ ...values, id });
        return {
          select: () => ({
            maybeSingle: async () => ({ data: { id }, error: null }),
          }),
        };
      },
      update(values: Row) {
        state.mode = "update";
        state.updateValues = values;
        return {
          eq: (column: string, value: unknown) => {
            state.filters.push({ column, op: "eq", value });
            state.updateId = String(value ?? "");
            const row = intents.find((entry) => entry.id === state.updateId);
            if (row && state.updateValues) Object.assign(row, state.updateValues);
            return Promise.resolve({ data: row ?? null, error: null });
          },
        };
      },
      maybeSingle: async () => {
        if (!infrastructureReady && table === "client_email_templates") {
          return { data: null, error: MISSING_TABLE };
        }
        if (
          table === "client_email_send_intents"
          && state.selectColumns.includes("intent_kind")
          && !testSchemaReady
        ) {
          return { data: null, error: MISSING_INTENT_KIND };
        }
        if (state.mode === "update" && state.updateId) {
          const row = intents.find((entry) => entry.id === state.updateId);
          if (row && state.updateValues) Object.assign(row, state.updateValues);
          return { data: row ?? null, error: null };
        }
        const rows = filter(table, state.filters);
        return { data: rows[0] ?? null, error: null };
      },
      then(
        onFulfilled?: (value: { data: Row[] | null; error: typeof MISSING_TABLE | typeof MISSING_INTENT_KIND | null; count?: number }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        if (!infrastructureReady && table === "client_email_templates") {
          return Promise.resolve({ data: null, error: MISSING_TABLE, count: 0 }).then(onFulfilled, onRejected);
        }
        if (
          table === "client_email_send_intents"
          && state.selectColumns.includes("intent_kind")
          && !testSchemaReady
        ) {
          return Promise.resolve({ data: null, error: MISSING_INTENT_KIND, count: 0 }).then(onFulfilled, onRejected);
        }
        let rows = filter(table, state.filters);
        if (state.limitValue < rows.length) rows = rows.slice(0, state.limitValue);
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  return { from: makeQuery, _intents: intents, _events: events };
}

const openTestEnv = {
  CLIENT_EMAIL_SENDING_ENABLED: "false",
  CLIENT_EMAIL_TEST_SENDING_ENABLED: "true",
  CLIENT_EMAIL_TEST_RECIPIENT: "liam@example.com",
  CLIENT_EMAIL_PROVIDER: "postmark",
  POSTMARK_SERVER_TOKEN: "server-token",
};

const activeTemplate = {
  id: "tpl-1",
  category: "needs_assistance",
  version: 2,
  subject: "Hello {{client_name}}",
  body_text: "Account {{instagram_username}} status {{account_status}}",
  body_html: "",
  status: "active",
};

test("forbidden recipient field in payload is rejected without fetch", async () => {
  let fetchCalled = false;
  const supabase = createMockSupabase({ templates: [activeTemplate] });
  const result = await executeClientEmailTestDelivery(
    supabase,
    { category: "needs_assistance", confirmed: true },
    { recipient_email: "other@example.com" },
    openTestEnv,
    async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "forbidden_recipient_field");
  assert.equal(fetchCalled, false);
});

test("closed test gates reject send without fetch", async () => {
  let fetchCalled = false;
  const supabase = createMockSupabase({ templates: [activeTemplate] });
  const result = await executeClientEmailTestDelivery(
    supabase,
    { category: "needs_assistance", confirmed: true },
    {},
    { CLIENT_EMAIL_TEST_SENDING_ENABLED: "false" },
    async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "gate_closed");
  assert.equal(fetchCalled, false);
});

test("successful test delivery creates test intent and persists provider message id", async () => {
  let fetchCalled = 0;
  const supabase = createMockSupabase({ templates: [activeTemplate] });
  const result = await executeClientEmailTestDelivery(
    supabase,
    { category: "needs_assistance", confirmed: true },
    { confirm: true },
    openTestEnv,
    async () => {
      fetchCalled += 1;
      return new Response(JSON.stringify({ MessageID: "pm-test-456" }), { status: 200 });
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.action, "sent");
  assert.equal(fetchCalled, 1);
  const intent = supabase._intents[0];
  assert.equal(intent.intent_kind, "test");
  assert.equal(intent.client_id, null);
  assert.equal(intent.account_id, null);
  assert.equal(intent.trigger, "manual_test");
  assert.equal(intent.status, "sent");
  assert.equal(intent.provider_message_id, "pm-test-456");
  assert.match(String(intent.snapshot_body_text), /test_account/);
  assert.match(String(intent.snapshot_body_text), /\btest\b/);
});

test("second test delivery attempt is idempotent", async () => {
  let fetchCalled = 0;
  const supabase = createMockSupabase({
    templates: [activeTemplate],
    intents: [{
      id: "intent-existing",
      idempotency_key: "manual_test:needs_assistance:tpl-1",
      intent_kind: "test",
      status: "sent",
      provider_message_id: "pm-test-456",
    }],
  });
  const result = await executeClientEmailTestDelivery(
    supabase,
    { category: "needs_assistance", confirmed: true },
    { confirm: true },
    openTestEnv,
    async () => {
      fetchCalled += 1;
      return new Response(JSON.stringify({ MessageID: "pm-test-999" }), { status: 200 });
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.action, "already_sent");
  assert.equal(fetchCalled, 0);
});

test("provider failure marks intent failed without retry", async () => {
  const supabase = createMockSupabase({ templates: [activeTemplate] });
  const result = await executeClientEmailTestDelivery(
    supabase,
    { category: "needs_assistance", confirmed: true },
    { confirm: true },
    openTestEnv,
    async () => new Response(JSON.stringify({ Message: "Rejected" }), { status: 422 }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "provider_error");
  assert.equal(supabase._intents[0]?.status, "failed");
  assert.ok(supabase._intents[0]?.last_error_redacted);
});

test("email history projects test delivery badge and masked recipient", async () => {
  const { loadClientEmailHistoryProjection } = await import("./client-email-history.ts");

  function makeHistoryQuery(table: string) {
    const intents = [{
      id: "intent-test",
      created_at: "2026-06-28T12:00:00.000Z",
      client_id: null,
      account_id: null,
      category: "needs_assistance",
      recipient_email: "liam@example.com",
      from_email: "growth@boostmybusinesses.com",
      trigger: "manual_test",
      reminder_index: null,
      status: "sent",
      template_version: 2,
      intent_kind: "test",
    }];
    const events = [{
      intent_id: "intent-test",
      status: "delivered",
      occurred_at: "2026-06-28T12:01:00.000Z",
    }];
    const state = { filters: [] as Array<{ column: string; op: string; value: unknown }>, columns: "*", range: null as { from: number; to: number } | null };
    const source = table === "client_email_send_intents" ? intents : table === "client_email_delivery_events" ? events : table === "client_email_templates" ? [{ id: "tpl" }] : [];
    const api = {
      select(columns?: string, _opts?: { count?: string }) {
        state.columns = columns ?? "*";
        return api;
      },
      eq(column: string, value: unknown) { state.filters.push({ column, op: "eq", value }); return api; },
      gte() { return api; },
      lte() { return api; },
      order() { return api; },
      in(column: string, value: unknown[]) { state.filters.push({ column, op: "in", value }); return api; },
      limit() { return api; },
      range(from: number, to: number) { state.range = { from, to }; return api; },
      maybeSingle: async () => {
        if (table === "client_email_send_intents" && state.columns.includes("intent_kind")) {
          return { data: intents[0], error: null };
        }
        return { data: source[0] ?? null, error: null };
      },
      then(onFulfilled?: (value: { data: Row[] | null; error: null; count?: number }) => unknown) {
        let rows = [...source];
        if (state.range) rows = rows.slice(state.range.from, state.range.to + 1);
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(onFulfilled);
      },
    };
    return api;
  }

  const supabase = { from: makeHistoryQuery };
  const projection = await loadClientEmailHistoryProjection(supabase as never, { period: "30d" });
  assert.equal(projection.items.length, 1);
  const item = projection.items[0];
  assert.equal(item.isTestDelivery, true);
  assert.equal(item.deliveryBadgeLabel, CLIENT_EMAIL_TEST_DELIVERY_LABEL);
  assert.equal(item.recipientEmail, "l***@example.com");
  assert.equal(item.clientName, null);
  assert.equal(item.deliveryStatus, "delivered");
});

test("loadClientEmailTestDeliveryStatus reports schema pending", async () => {
  const supabase = createMockSupabase({ testSchemaReady: false, templates: [activeTemplate] });
  const status = await loadClientEmailTestDeliveryStatus(supabase, openTestEnv);
  assert.equal(status.canSendTest, false);
  assert.equal(status.testSchemaReady, false);
});
