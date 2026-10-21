import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import ts from "typescript";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const url = (s) =>
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const domainUrl = url(read("./followup-domain.ts"));
const d = await import(domainUrl);
const providerUrl = url(read("./followup-providers.ts").replaceAll('"./followup-domain"', JSON.stringify(domainUrl)));
const certification = await import(url(read("./followup-certification.ts").replaceAll('"./followup-domain"', JSON.stringify(domainUrl)).replaceAll('"./followup-providers"', JSON.stringify(providerUrl))));
const analytics = await import(url(read("./followup-analytics.ts")));
const p = await import(
  url(
    read("./followup-providers.ts").replaceAll(
      '"./followup-domain"',
      JSON.stringify(domainUrl),
    ),
  )
);
const c = {
  market: "FR",
  owner: "owner",
  now: "2026-09-08T10:00:00.000Z",
  eventId: "event-1",
  email: "fixture@example.invalid",
  phone: "+33600000000",
};
test('owner production certification fixtures are internally consistent with zero transport', () => {
  const result = certification.certifyFollowupFixtures();
  assert.equal(result.passed, true);
  assert.equal(result.crm_writes, 0);
  assert.equal(result.real_contacts, 0);
  assert.equal(result.openai_calls, 0);
});
test('empty analytics never invent a conversion rate or a payment', () => {
  const result = analytics.followupAnalytics([]);
  assert.equal(result.total.paid, 0);
  assert.equal(result.total.call_to_demo_percent, null);
  assert.deepEqual(result.market, {});
});
const booking = (id = "b1", patch = {}) => ({
  id,
  event_uri: "https://api.calendly.com/scheduled_events/test",
  start: "2026-09-10T10:00:00.000Z",
  end: "2026-09-10T10:30:00.000Z",
  timezone: "Europe/Paris",
  meeting_url: "https://meet.google.com/aaa-bbbb-ccc",
  cancel_url: "https://calendly.com/cancellations/test",
  reschedule_url: "https://calendly.com/reschedulings/test",
  status: "active",
  old_invitee: null,
  new_invitee: null,
  updated_at: c.now,
  ...patch,
});
const reply = (text) => ({
  kind: "reply",
  reply: {
    id: "r1",
    raw_response: text,
    channel: "email",
    source_message_id: "source",
    conversation_id: "thread",
    contact_id: null,
    outreach_item_id: null,
    received_at: c.now,
    classification: null,
    confidence: null,
    reasoning_safe: null,
    classifier_version: null,
    human_review_required: true,
  },
});
const reduce = (state, cmd, context = c) =>
  d.reduceFollowup(state, cmd, context).state;
for (const [text, kind] of [
  ["I am interested", "POSITIVE_INTEREST"],
  ["Can you call me?", "REQUEST_CALL"],
  ["Call me back tomorrow at 14:00", "REQUEST_CALLBACK"],
  ["Can I book a demo?", "BOOKING_INTENT"],
  ["Not interested", "NOT_INTERESTED"],
  ["What is the price?", "PRICE_QUESTION"],
  ["Maybe later", "NOT_NOW"],
  ["Please unsubscribe me", "DO_NOT_CONTACT"],
  ["Out of office", "OUT_OF_OFFICE"],
  ["Automatic reply", "SYSTEM_AUTOREPLY"],
  ["Hmm", "AMBIGUOUS"],
  ["Don't call me", "AMBIGUOUS"],
])
  test(`classify ${kind}: ${text}`, () =>
    assert.equal(d.classifyReply(text).classification, kind));
test("reply creates review action and duplicate does not duplicate canonical response", () => {
  const first = reduce(d.emptyFollowup(), reply("Hmm"));
  assert.equal(first.actions[0].action_type, "REPLY");
  assert.deepEqual(reduce(first, reply("Hmm")), first);
});
test("booking intention skips calls; cold price question prepares no pricing", () => {
  for (const text of ["Can I book a demo?", "What is the price?"]) {
    let s = reduce(d.emptyFollowup(), reply(text));
    s = reduce(
      s,
      { kind: "classify", reply_id: "r1" },
      { ...c, eventId: "e2" },
    );
    assert.equal(
      s.actions.filter((a) => a.status === "pending")[0].action_type,
      text.includes("demo") ? "BOOK_DEMO" : "REPLY",
    );
    assert.equal(s.notifications.length, 0);
  }
});
test("next action reschedule, cancel, complete and dedupe active intent", () => {
  let s = d.emptyFollowup();
  s = reduce(s, {
    kind: "next_action",
    action_type: "CALL",
    due_at: c.now,
    reason: "test",
  });
  s = reduce(
    s,
    {
      kind: "next_action",
      action_type: "CALLBACK",
      due_at: "2026-09-09T10:00:00Z",
      reason: "new time",
    },
    { ...c, eventId: "e2" },
  );
  assert.equal(s.actions.filter((a) => a.status === "pending").length, 1);
  assert.equal(s.actions[0].status, "cancelled");
  s = reduce(s, {
    kind: "action_status",
    action_id: "e2:action",
    status: "completed",
  });
  assert.equal(s.actions[1].completed_at, c.now);
  assert.throws(() =>
    reduce(s, {
      kind: "action_status",
      action_id: "e2:action",
      status: "cancelled",
    }),
  );
});
test("timezone FR summer/winter + ZA and DST gap/fold rejection", () => {
  assert.equal(
    d.localToInstant("2026-09-10T14:00", "Europe/Paris"),
    "2026-09-10T12:00:00.000Z",
  );
  assert.equal(
    d.localToInstant("2026-12-10T14:00", "Europe/Paris"),
    "2026-12-10T13:00:00.000Z",
  );
  assert.equal(
    d.localToInstant("2026-12-10T14:00", "Africa/Johannesburg"),
    "2026-12-10T12:00:00.000Z",
  );
  assert.throws(() => d.localToInstant("2026-03-29T02:30", "Europe/Paris"));
  assert.throws(() => d.localToInstant("2026-10-25T02:30", "Europe/Paris"));
  assert.throws(() => d.instant("2026-09-10T14:00"));
  assert.equal(
    d.callbackTime("tomorrow at 14:00", c.now, "FR"),
    "2026-09-09T12:00:00.000Z",
  );
});
test("E164 normalization does not suffix-match unqualified numbers", () => {
  assert.equal(d.normalizePhone("06 00 00 00 00", "FR"), "+33600000000");
  assert.equal(d.normalizePhone("082 000 0000", "ZA"), "+27820000000");
  assert.equal(d.normalizePhone("600000000", "FR"), null);
});
const onoff = {
  id: "call-1",
  eventName: "CDR",
  externalNumber: "+33600000000",
  onoffUserNumber: "+33100000000",
  callStarted: c.now,
  callEnded: "2026-09-08T10:02:00Z",
  callDuration: 120,
  callDirection: "OUTBOUND",
  callStatus: "ANSWERED",
};
test("Onoff documented answered, missed, incoming, malformed and normalized safe retention", () => {
  for (const [status, direction] of [
    ["ANSWERED", "OUTBOUND"],
    ["MISSED_CALL", "OUTBOUND"],
    ["ANSWERED", "INBOUND"],
  ]) {
    const result = p.normalizeOnoff(
      {
        ...onoff,
        callStatus: status,
        callDirection: direction,
        onoffUserEmail: "private@example.invalid",
      },
      "e",
    );
    assert.equal(result.call.status, status);
    assert.equal(result.call.direction, direction);
    assert.equal(result.safeRaw.onoffUserEmail, undefined);
  }
  assert.throws(() =>
    p.normalizeOnoff({ ...onoff, callStatus: "invented" }, "e"),
  );
  assert.throws(() => p.normalizeOnoff({}, "e"));
});
test("human call click cannot be inferred; outcome only recorded from provider or disposition", () => {
  let s = reduce(d.emptyFollowup(), {
    kind: "call",
    call: p.normalizeOnoff(onoff, "e").call,
  });
  assert.equal(s.calls.length, 1);
  assert.equal(s.bookings.length, 0);
  s = reduce(
    s,
    {
      kind: "call_disposition",
      call_id: "onoff:call-1",
      disposition: "INTERESTED",
    },
    { ...c, eventId: "e2" },
  );
  assert.equal(
    s.actions.filter((a) => a.status === "pending")[0].action_type,
    "BOOK_DEMO",
  );
  assert.equal(s.notifications.length, 0);
  assert.throws(() =>
    reduce(s, {
      kind: "call_disposition",
      call_id: "missing",
      disposition: "INTERESTED",
    }),
  );
});
test("SA local manual flow and provider market mismatch", () => {
  const call = {
    ...p.normalizeOnoff(onoff, "e").call,
    provider: "local_manual",
    id: "sa",
  };
  assert.throws(() => reduce(d.emptyFollowup(), { kind: "call", call }));
  let s = reduce(
    d.emptyFollowup(),
    { kind: "call", call },
    { ...c, market: "ZA" },
  );
  s = reduce(
    s,
    {
      kind: "call_disposition",
      call_id: "sa",
      disposition: "CALLBACK",
      due_at: "2026-09-09T12:00:00Z",
    },
    { ...c, market: "ZA", eventId: "e2" },
  );
  assert.equal(s.actions.at(-1).timezone, "Africa/Johannesburg");
});
test("booking prepares exactly four dry-run notifications; no automatic demo completion", () => {
  const s = reduce(d.emptyFollowup(), { kind: "booking", booking: booking() });
  assert.equal(s.notifications.length, 4);
  assert.ok(s.notifications.every((n) => n.status === "READY_DRY_RUN"));
  assert.match(s.notifications[0].body, /Europe\/Paris/);
  assert.equal(s.bookings[0].disposition, undefined);
  assert.equal(
    s.notifications.find((n) => n.kind === "reminder_sms_1h").due_at,
    "2026-09-10T09:00:00.000Z",
  );
});
test("cancel and old/new reschedule in both delivery orders, duplicate and late create", () => {
  for (const order of ["cancel-first", "create-first"]) {
    let s = reduce(d.emptyFollowup(), { kind: "booking", booking: booking() });
    const old = booking("b1", {
        status: "cancelled",
        new_invitee: "b2",
        updated_at: "2026-09-08T11:00:00Z",
      }),
      next = booking("b2", {
        old_invitee: "b1",
        updated_at: "2026-09-08T11:00:00Z",
        meeting_url: "https://meet.google.com/ddd-eeee-fff",
      });
    for (const b of order === "cancel-first" ? [old, next] : [next, old])
      s = reduce(s, { kind: "booking", booking: b }, { ...c, eventId: b.id });
    assert.equal(s.bookings.filter((b) => b.status === "active").length, 1);
    assert.ok(
      s.notifications
        .filter((n) => n.booking_id === "b1")
        .every((n) => n.status === "CANCELLED"),
    );
    assert.equal(
      s.bookings.find((b) => b.id === "b2").meeting_url,
      next.meeting_url,
    );
    s = reduce(s, { kind: "booking", booking: booking() });
    assert.equal(s.bookings.filter((b) => b.status === "active").length, 1);
  }
});
test("missing Meet or recipient fails closed", () => {
  const s = reduce(d.emptyFollowup(), {
    kind: "booking",
    booking: booking("b1", { meeting_url: null }),
  });
  assert.ok(s.notifications.every((n) => n.status === "FAILED_CLOSED"));
  assert.equal(
    d.notificationPreview(booking(), "confirmation_sms", { ...c, phone: null })
      .status,
    "FAILED_CLOSED",
  );
});
test("only completed human demo with INTERESTED prepares pricing; revised outcome cancels it", () => {
  for (const disposition of [
    "INTERESTED",
    "FOLLOW_UP_NEEDED",
    "NOT_INTERESTED",
    "NO_SHOW",
  ]) {
    let s = reduce(d.emptyFollowup(), { kind: "booking", booking: booking() });
    assert.throws(() =>
      reduce(s, { kind: "demo_disposition", booking_id: "b1", disposition }),
    );
    s = reduce(
      s,
      { kind: "demo_disposition", booking_id: "b1", disposition },
      { ...c, now: "2026-09-10T11:00:00Z", eventId: "e2" },
    );
    assert.equal(
      s.notifications.filter(
        (n) => n.kind === "pricing_email" && n.status === "READY_DRY_RUN",
      ).length,
      disposition === "INTERESTED" ? 1 : 0,
    );
    if (disposition === "INTERESTED") {
      assert.match(s.notifications.at(-1).body, /45 jours/);
      assert.match(
        d.notificationPreview(booking(), "pricing_email", {
          ...c,
          market: "ZA",
        }).body,
        /Pay for 30 days. Get 45 days./,
      );
      s = reduce(
        s,
        {
          kind: "demo_disposition",
          booking_id: "b1",
          disposition: "NOT_INTERESTED",
        },
        { ...c, now: "2026-09-10T12:00:00Z" },
      );
      assert.equal(s.notifications.at(-1).status, "CANCELLED");
    }
  }
});
test("unsubscribe suppresses all actions and notification simulation", () => {
  let s = reduce(d.emptyFollowup(), reply("Please unsubscribe me"));
  s = reduce(s, { kind: "classify", reply_id: "r1" });
  assert.equal(s.do_not_contact, true);
  assert.ok(s.actions.every((a) => a.status === "cancelled"));
  assert.throws(() =>
    reduce(s, {
      kind: "next_action",
      action_type: "CALL",
      due_at: c.now,
      reason: "test",
    }),
  );
});
test("provider signatures reject forged, stale, missing secret", () => {
  const secret = "s".repeat(32),
    body = "{}",
    timestamp = String(Date.parse(c.now) / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  assert.equal(
    p.calendlySignature(
      body,
      `t=${timestamp},v1=${signature}`,
      secret,
      Date.parse(c.now),
    ),
    true,
  );
  assert.equal(
    p.calendlySignature(
      "bad",
      `t=${timestamp},v1=${signature}`,
      secret,
      Date.parse(c.now),
    ),
    false,
  );
  assert.equal(
    p.calendlySignature(
      body,
      `t=${timestamp},v1=${signature}`,
      secret,
      Date.parse(c.now) + 181000,
    ),
    false,
  );
  assert.equal(p.sameSecret(secret, undefined), false);
});
test("Calendly real payload schema and URLs are validated", () => {
  const raw = {
    event: "invitee.created",
    created_at: c.now,
    payload: {
      uri: "https://api.calendly.com/scheduled_events/e/invitees/i",
      event: "https://api.calendly.com/scheduled_events/e",
      email: "fixture@example.invalid",
      timezone: "Europe/Paris",
      scheduled_event: {
        start_time: booking().start,
        end_time: booking().end,
        location: { join_url: booking().meeting_url },
      },
      cancel_url: booking().cancel_url,
      reschedule_url: booking().reschedule_url,
    },
  };
  assert.equal(
    p.normalizeCalendly(raw, "FR").booking.meeting_url,
    booking().meeting_url,
  );
  assert.throws(() =>
    p.safeProviderUrl("javascript:alert(1)", ["meet.google.com"]),
  );
  assert.throws(() => p.normalizeCalendly({ ...raw, event: "other" }, "FR"));
});
test("all live transports remain structurally off", () => {
  assert.ok(Object.values(d.TRANSPORTS).every((v) => v === false));
  for (const file of [
    "./followup-domain.ts",
    "./followup-service.ts",
    "./followup-webhook.ts",
  ])
    assert.doesNotMatch(
      read(file),
      /sendEmail\(|sendSms\(|twilio\(|api\.openai\.com|tel:/,
    );
});
