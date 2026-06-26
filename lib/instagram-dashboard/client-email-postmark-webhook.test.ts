import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPostmarkWebhookEventId,
  ingestPostmarkWebhookEvent,
  parsePostmarkWebhookPayload,
} from "./client-email-postmark-webhook.ts";

type Row = Record<string, unknown>;

function createMockSupabase(input: {
  intents?: Row[];
  events?: Row[];
}) {
  const intents = [...(input.intents ?? [])];
  const events = [...(input.events ?? [])];

  function match(row: Row, column: string, value: string) {
    return String(row[column] ?? "") === value;
  }

  function makeQuery(table: string) {
    const state = {
      filters: [] as Array<{ column: string; value: string }>,
      insertValues: null as Row | null,
      mode: "select" as "select" | "insert",
    };

    const builder = {
      select() {
        state.mode = "select";
        return builder;
      },
      eq(column: string, value: string) {
        state.filters.push({ column, value });
        return builder;
      },
      maybeSingle: async () => {
        const source = table === "client_email_send_intents" ? intents : events;
        const row = source.find((entry) => state.filters.every((filter) => match(entry, filter.column, filter.value))) ?? null;
        return { data: row, error: null };
      },
      insert(values: Row) {
        state.insertValues = values;
        const duplicate = events.some((entry) => entry.webhook_event_id === values.webhook_event_id);
        if (duplicate) {
          return Promise.resolve({ error: { message: "duplicate key value violates unique constraint" } });
        }
        events.push(values);
        return Promise.resolve({ error: null });
      },
    };

    return builder;
  }

  return {
    from(table: string) {
      return makeQuery(table);
    },
    _events: events,
  };
}

test("delivery webhook maps to delivered status with intent metadata", () => {
  const parsed = parsePostmarkWebhookPayload({
    RecordType: "Delivery",
    MessageStream: "outbound",
    MessageID: "pm-1",
    Recipient: "owner@example.com",
    DeliveredAt: "2026-06-26T12:00:00.000Z",
    Metadata: { intent_id: "intent-1" },
  });
  assert.ok(parsed);
  assert.equal(parsed?.deliveryStatus, "delivered");
  assert.equal(parsed?.intentId, "intent-1");
});

test("bounce webhook is idempotent", async () => {
  const supabase = createMockSupabase({
    intents: [{
      id: "intent-1",
      recipient_email: "owner@example.com",
      client_id: "client-a",
    }],
    events: [],
  });

  const payload = {
    RecordType: "Bounce",
    MessageStream: "outbound",
    MessageID: "pm-bounce-1",
    ID: 99,
    Email: "owner@example.com",
    BouncedAt: "2026-06-26T12:01:00.000Z",
    Description: "Mailbox not found",
    Metadata: { intent_id: "intent-1" },
  };

  const first = await ingestPostmarkWebhookEvent(supabase as never, payload);
  const second = await ingestPostmarkWebhookEvent(supabase as never, payload);
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.action, "stored");
  assert.equal(second.ok, true);
  assert.equal(second.ok && second.action, "duplicate");
  assert.equal(supabase._events.length, 1);
});

test("unknown record type is ignored without crash", async () => {
  const supabase = createMockSupabase({ intents: [], events: [] });
  const result = await ingestPostmarkWebhookEvent(supabase as never, {
    RecordType: "Open",
    MessageStream: "outbound",
    MessageID: "pm-open",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.action, "ignored");
});

test("provider error text is redacted in stored event", async () => {
  const supabase = createMockSupabase({
    intents: [{ id: "intent-1", recipient_email: "owner@example.com", client_id: "client-a" }],
    events: [],
  });

  const result = await ingestPostmarkWebhookEvent(supabase as never, {
    RecordType: "SMTPApiError",
    MessageStream: "outbound",
    MessageID: "pm-error-1",
    ID: 12,
    Email: "owner@example.com",
    SubmittedAt: "2026-06-26T12:02:00.000Z",
    Details: "smtp;550 user unknown at owner@example.com",
    Metadata: { intent_id: "intent-1" },
  });

  assert.equal(result.ok, true);
  const stored = supabase._events[0];
  assert.match(String(stored.last_error_redacted), /\[redacted-email\]/);
  assert.doesNotMatch(String(stored.last_error_redacted), /owner@example.com/);
});

test("recipient mismatch is ignored to avoid cross-tenant writes", async () => {
  const supabase = createMockSupabase({
    intents: [{ id: "intent-1", recipient_email: "owner@example.com", client_id: "client-a" }],
    events: [],
  });

  const result = await ingestPostmarkWebhookEvent(supabase as never, {
    RecordType: "Delivery",
    MessageStream: "outbound",
    MessageID: "pm-2",
    Recipient: "other@example.com",
    DeliveredAt: "2026-06-26T12:03:00.000Z",
    Metadata: { intent_id: "intent-1" },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.action, "ignored");
  assert.equal(result.reason, "recipient_snapshot_mismatch");
  assert.equal(supabase._events.length, 0);
});

test("webhook event id is stable for duplicate detection", () => {
  const payload = {
    RecordType: "Delivery",
    MessageID: "pm-1",
    DeliveredAt: "2026-06-26T12:00:00.000Z",
    ID: 7,
  };
  assert.equal(
    buildPostmarkWebhookEventId(payload),
    buildPostmarkWebhookEventId(payload),
  );
});
