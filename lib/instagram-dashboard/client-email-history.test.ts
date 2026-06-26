import assert from "node:assert/strict";
import test from "node:test";
import {
  loadClientEmailHistoryDetail,
  loadClientEmailHistoryProjection,
} from "./client-email-history.ts";

const MISSING_TABLE_ERROR = {
  message: "Could not find the table 'public.client_email_templates' in the schema cache",
  code: "PGRST205",
};

type Row = Record<string, unknown>;

function createMockSupabase(input: {
  intents?: Row[];
  events?: Row[];
  accounts?: Row[];
  clients?: Row[];
  tableMissing?: boolean;
}) {
  const intents = [...(input.intents ?? [])];
  const events = [...(input.events ?? [])];
  const accounts = [...(input.accounts ?? [])];
  const clients = [...(input.clients ?? [])];
  const tableMissing = input.tableMissing === true;

  function filter(table: string, filters: Array<{ column: string; op: string; value: unknown }>) {
    const source = table === "client_email_send_intents" ? intents
      : table === "client_email_delivery_events" ? events
        : table === "ig_accounts" ? accounts
          : table === "clients" ? clients
            : [];
    return source.filter((row) => filters.every((filter) => {
      if (filter.op === "eq") return row[filter.column] === filter.value;
      if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
      if (filter.op === "gte") return String(row[filter.column] ?? "") >= String(filter.value ?? "");
      if (filter.op === "lte") return String(row[filter.column] ?? "") <= String(filter.value ?? "");
      return true;
    }));
  }

  function makeQuery(table: string) {
    const state = {
      filters: [] as Array<{ column: string; op: string; value: unknown }>,
      order: null as { column: string; ascending: boolean } | null,
      range: null as { from: number; to: number } | null,
      count: null as string | null,
      limitValue: 100,
    };

    const api = {
      select(_columns?: string, options?: { count?: string }) {
        if (options?.count) state.count = options.count;
        return api;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ column, op: "eq", value });
        return api;
      },
      in(column: string, value: unknown[]) {
        state.filters.push({ column, op: "in", value });
        return api;
      },
      gte(column: string, value: unknown) {
        state.filters.push({ column, op: "gte", value });
        return api;
      },
      lte(column: string, value: unknown) {
        state.filters.push({ column, op: "lte", value });
        return api;
      },
      order(column: string, options?: { ascending?: boolean }) {
        state.order = { column, ascending: options?.ascending !== false };
        return api;
      },
      limit(count: number) {
        state.limitValue = count;
        return api;
      },
      range(from: number, to: number) {
        state.range = { from, to };
        return api;
      },
      maybeSingle: async () => {
        if (tableMissing) return { data: null, error: MISSING_TABLE_ERROR };
        const rows = filter(table, state.filters);
        return { data: rows[0] ?? null, error: null };
      },
      then(
        onFulfilled?: (value: { data: Row[] | null; error: typeof MISSING_TABLE_ERROR | null; count?: number }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        if (tableMissing && table === "client_email_templates") {
          return Promise.resolve({ data: null, error: MISSING_TABLE_ERROR, count: 0 }).then(onFulfilled, onRejected);
        }
        if (tableMissing) {
          return Promise.resolve({ data: null, error: MISSING_TABLE_ERROR, count: 0 }).then(onFulfilled, onRejected);
        }
        let rows = filter(table, state.filters);
        if (state.order) {
          rows = [...rows].sort((a, b) => {
            const left = String(a[state.order!.column] ?? "");
            const right = String(b[state.order!.column] ?? "");
            return state.order!.ascending ? left.localeCompare(right) : right.localeCompare(left);
          });
        }
        const total = rows.length;
        if (state.range) rows = rows.slice(state.range.from, state.range.to + 1);
        else if (state.limitValue < rows.length) rows = rows.slice(0, state.limitValue);
        return Promise.resolve({ data: rows, error: null, count: total }).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  return { from: makeQuery };
}

test("email history unavailable before migration", async () => {
  const supabase = createMockSupabase({ tableMissing: true });
  const projection = await loadClientEmailHistoryProjection(supabase as never);
  assert.equal(projection.featureAvailable, false);
  assert.equal(projection.items.length, 0);
});

test("email history supports filters and pagination", async () => {
  const supabase = createMockSupabase({
    intents: [
      {
        id: "intent-1",
        created_at: "2026-06-20T12:00:00.000Z",
        client_id: "client-a",
        account_id: "acct-a",
        category: "needs_more_target_accounts",
        recipient_email: "owner@example.com",
        from_email: "growth@boostmybusinesses.com",
        trigger: "reminder",
        reminder_index: 1,
        status: "sent",
        template_version: 2,
      },
      {
        id: "intent-2",
        created_at: "2026-06-18T12:00:00.000Z",
        client_id: "client-b",
        account_id: "acct-b",
        category: "account_paused",
        recipient_email: "other@example.com",
        from_email: "growth@boostmybusinesses.com",
        trigger: "manual",
        reminder_index: 0,
        status: "pending",
        template_version: 1,
      },
    ],
    accounts: [
      { id: "acct-a", username: "alpha_acc" },
      { id: "acct-b", username: "beta_acc" },
    ],
    clients: [
      { id: "client-a", name: "Client A" },
      { id: "client-b", name: "Client B" },
    ],
    events: [
      { intent_id: "intent-1", status: "delivered", occurred_at: "2026-06-20T12:05:00.000Z" },
    ],
  });

  const projection = await loadClientEmailHistoryProjection(supabase as never, {
    clientId: "client-a",
    category: "needs_more_target_accounts",
    trigger: "reminder",
    page: 1,
    pageSize: 10,
  });

  assert.equal(projection.featureAvailable, true);
  assert.equal(projection.items.length, 1);
  assert.equal(projection.items[0].instagramUsername, "alpha_acc");
  assert.equal(projection.items[0].deliveryStatus, "delivered");
  assert.match(projection.items[0].recipientEmail, /\*\*\*@/);
});

test("email history detail returns redacted timeline", async () => {
  const supabase = createMockSupabase({
    intents: [{
      id: "intent-1",
      created_at: "2026-06-20T12:00:00.000Z",
      client_id: "client-a",
      account_id: "acct-a",
      category: "needs_assistance",
      recipient_email: "owner@example.com",
      from_email: "growth@boostmybusinesses.com",
      trigger: "automatic",
      reminder_index: 0,
      status: "sent",
      template_version: 1,
      snapshot_subject: "Help needed",
      snapshot_body_text: "Please assist",
      snapshot_body_html: "<p>Please assist</p>",
      source_notification_id: "notif-1",
      source_action_id: null,
      scheduled_for: "2026-06-20T12:00:00.000Z",
      sent_at: "2026-06-20T12:01:00.000Z",
      resolved_at: null,
    }],
    accounts: [{ id: "acct-a", username: "alpha_acc" }],
    clients: [{ id: "client-a", name: "Client A" }],
    events: [{
      intent_id: "intent-1",
      status: "sent",
      occurred_at: "2026-06-20T12:01:00.000Z",
      provider: "postmark",
      provider_message_id: "pm-123",
      last_error_redacted: null,
    }],
  });

  const result = await loadClientEmailHistoryDetail(supabase as never, "intent-1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.detail.sourceNotificationId, "notif-1");
  assert.equal(result.detail.timeline.length, 1);
  assert.equal(result.detail.providerMessageId, "pm-123");
  assert.match(result.detail.recipientEmail, /\*\*\*@/);
});
