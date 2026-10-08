/** Pure commercial follow-up projection. No network, dialer or delivery dependency. */
export const MARKETS = {
  FR: {
    language: "fr",
    timezone: "Europe/Paris",
    phoneProvider: "onoff",
    label: "France",
  },
  ZA: {
    language: "en",
    timezone: "Africa/Johannesburg",
    phoneProvider: "local_manual",
    label: "South Africa",
  },
} as const;
export type Market = keyof typeof MARKETS;
export const PRICING_URL =
  "https://www.boostmybusinesses.com/instagram-growth#pricing";
export const TRANSPORTS = Object.freeze({
  coldEmail: false,
  instagramDm: false,
  franceCall: false,
  southAfricaCall: false,
  confirmationEmail: false,
  confirmationSms: false,
  pricingEmail: false,
  autoApproval: false,
});
export const CLASSIFICATIONS = [
  "POSITIVE_INTEREST",
  "QUESTION",
  "PRICE_QUESTION",
  "REQUEST_CALL",
  "REQUEST_CALLBACK",
  "BOOKING_INTENT",
  "NOT_NOW",
  "NOT_INTERESTED",
  "DO_NOT_CONTACT",
  "OUT_OF_OFFICE",
  "AMBIGUOUS",
  "SYSTEM_AUTOREPLY",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const ACTIONS = [
  "PRE_CALL",
  "CALL",
  "CALLBACK",
  "REPLY",
  "BOOK_DEMO",
  "FOLLOW_UP",
  "SEND_PRICING",
  "CHECK_PAYMENT",
  "NONE",
] as const;
export type ActionType = (typeof ACTIONS)[number];
export type NextAction = {
  id: string;
  intention: string;
  action_type: ActionType;
  due_at: string;
  timezone: string;
  channel: string;
  owner: string;
  reason: string;
  source_event_id: string;
  status: "pending" | "completed" | "cancelled";
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
};
export type Reply = {
  id: string;
  raw_response: string;
  channel: "email" | "instagram";
  source_message_id: string;
  conversation_id: string;
  contact_id: string | null;
  outreach_item_id: string | null;
  received_at: string;
  classification: Classification | null;
  confidence: number | null;
  reasoning_safe: string | null;
  classifier_version: string | null;
  human_review_required: boolean;
};
export type Call = {
  id: string;
  provider: "onoff" | "local_manual";
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  started_at: string;
  ended_at: string;
  duration: number | null;
  recording_reference: string | null;
  disposition?: string;
  source_event_id: string;
};
export type Booking = {
  id: string;
  event_uri: string;
  start: string | null;
  end: string | null;
  timezone: string;
  meeting_url: string | null;
  cancel_url: string | null;
  reschedule_url: string | null;
  status: "active" | "cancelled";
  old_invitee: string | null;
  new_invitee: string | null;
  disposition?: string;
  pre_call_status?: "pending" | "completed" | "no_answer" | "skipped" | "skipped_due_to_short_notice" | "awaiting_demo_time" | "cancelled";
  attribution?: Record<string, unknown>;
  questions_and_answers?: Array<{ question: string; answer: string }>;
  updated_at: string;
};
export type Notification = {
  id: string;
  booking_id: string;
  kind:
    | "confirmation_email"
    | "confirmation_sms"
    | "reminder_email_24h"
    | "reminder_sms_1h"
    | "pricing_email";
  channel: "email" | "sms";
  due_at: string;
  status: "READY_DRY_RUN" | "CANCELLED" | "SENT_SIMULATED" | "FAILED_CLOSED";
  subject: string | null;
  body: string;
  reason: string | null;
};
export type FollowupState = {
  schema_version: 1;
  replies: Reply[];
  actions: NextAction[];
  calls: Call[];
  bookings: Booking[];
  notifications: Notification[];
  do_not_contact: boolean;
};
export type Context = {
  market: Market;
  owner: string;
  now: string;
  eventId: string;
  email: string | null;
  phone: string | null;
};
export type Command =
  | { kind: "pre_call_disposition"; booking_id: string; disposition: "completed" | "no_answer" | "skipped" }
  | { kind: "reply"; reply: Reply }
  | { kind: "classify"; reply_id: string }
  | {
      kind: "next_action";
      action_type: ActionType;
      due_at: string;
      reason: string;
      intention?: string;
    }
  | {
      kind: "action_status";
      action_id: string;
      status: "completed" | "cancelled";
    }
  | { kind: "call"; call: Call }
  | {
      kind: "call_disposition";
      call_id: string;
      disposition:
        | "INTERESTED"
        | "CALLBACK"
        | "DEMO_BOOKED"
        | "NOT_INTERESTED"
        | "NO_ANSWER"
        | "OTHER";
      due_at?: string;
    }
  | { kind: "booking"; booking: Booking }
  | {
      kind: "demo_disposition";
      booking_id: string;
      disposition:
        | "INTERESTED"
        | "FOLLOW_UP_NEEDED"
        | "NOT_INTERESTED"
        | "NO_SHOW";
    }
  | { kind: "simulate_notification"; notification_id: string };
export function emptyFollowup(): FollowupState {
  return {
    schema_version: 1,
    replies: [],
    actions: [],
    calls: [],
    bookings: [],
    notifications: [],
    do_not_contact: false,
  };
}
export function requireMarket(value: string): Market {
  if (value !== "FR" && value !== "ZA") throw new Error("unsupported_market");
  return value;
}
export function instant(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("timestamp_with_offset_required");
  const year = Number(value.slice(0, 4)),
    month = Number(value.slice(5, 7)),
    day = Number(value.slice(8, 10));
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())
    throw new Error("invalid_calendar_date");
  return new Date(value).toISOString();
}
function wallParts(date: Date, timezone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
}
/** Reject nonexistent/ambiguous DST wall times; never choose a hidden offset. */
export function localToInstant(local: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error("local_datetime_required");
  const base = Date.parse(local + ":00Z");
  const found: string[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const date = new Date(base + offset * 60000);
    const p = wallParts(date, timezone);
    if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === local)
      found.push(date.toISOString());
  }
  if (found.length !== 1)
    throw new Error(
      found.length ? "ambiguous_local_time" : "nonexistent_local_time",
    );
  return found[0];
}
export function callbackTime(
  text: string,
  receivedAt: string,
  market: Market,
): string | null {
  const match = /^(?:tomorrow|demain) (?:at|à) (\d{1,2}):(\d{2})$/i.exec(
    text.trim(),
  );
  if (!match || +match[1] > 23 || +match[2] > 59) return null;
  const p = wallParts(new Date(instant(receivedAt)), MARKETS[market].timezone);
  const tomorrow = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + 1))
    .toISOString()
    .slice(0, 10);
  return localToInstant(
    `${tomorrow}T${match[1].padStart(2, "0")}:${match[2]}`,
    MARKETS[market].timezone,
  );
}
export function normalizePhone(value: string, market: Market): string | null {
  let phone = value
    .trim()
    .replace(/[\s().-]/g, "")
    .replace(/^00/, "+");
  if (/^0[1-9]\d{8}$/.test(phone))
    phone = (market === "FR" ? "+33" : "+27") + phone.slice(1);
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
export function classifyReply(raw: string): {
  classification: Classification;
  confidence: number;
  reasoning_safe: string;
  classifier_version: string;
  human_review_required: boolean;
} {
  const text = raw.normalize("NFKC").trim().toLowerCase();
  const matches: Classification[] = [];
  const rules: [Classification, RegExp][] = [
    [
      "DO_NOT_CONTACT",
      /\b(unsubscribe|stop contacting|do not contact|remove me|ne me contactez plus|désabonnez|desabonnez)\b/,
    ],
    ["NOT_INTERESTED", /\b(not interested|pas intéress[ée]|pas interesse)\b/],
    ["OUT_OF_OFFICE", /\b(out of office|absent du bureau|en congé)\b/],
    [
      "SYSTEM_AUTOREPLY",
      /\b(automatic reply|automated response|réponse automatique)\b/,
    ],
    ["NOT_NOW", /\b(not now|maybe later|pas maintenant|plus tard)\b/],
    [
      "REQUEST_CALLBACK",
      /\b(call me back|callback|rappelle[zr]?|rappelez-moi)\b/,
    ],
    [
      "REQUEST_CALL",
      /\b(call me(?! back)|can you call(?! me back)|appelez-moi|pouvez-vous m'appeler)\b/,
    ],
    [
      "BOOKING_INTENT",
      /\b(book a demo|send me your calendar|let's schedule|réserver une démo|reserver une demo|votre calendrier)\b/,
    ],
    ["PRICE_QUESTION", /\b(price|pricing|cost|tarif|prix|combien)\b/],
    [
      "POSITIVE_INTEREST",
      /^(?:yes[,! ]*)?(?:i(?:'m| am) interested|sounds good|je suis intéress[ée]|oui[,! ]*cela m'intéresse)[.! ]*$/,
    ],
  ];
  for (const [kind, pattern] of rules)
    if (pattern.test(text)) matches.push(kind);
  const stop = matches.includes("DO_NOT_CONTACT");
  // Negated requests, quoted conversations and mixed intentions are never auto-resolved.
  const unsafe =
    /\b(don't|do not|cannot|can't|ne .*pas)\b/.test(text) ||
    /(^>|\bon .*wrote:|a écrit :)/m.test(text);
  const classification: Classification = stop
    ? "DO_NOT_CONTACT"
    : unsafe || matches.length > 1
      ? "AMBIGUOUS"
      : (matches[0] ?? (text.endsWith("?") ? "QUESTION" : "AMBIGUOUS"));
  const confidence =
    classification === "AMBIGUOUS"
      ? 0.2
      : classification === "QUESTION"
        ? 0.7
        : 0.92;
  return {
    classification,
    confidence,
    reasoning_safe:
      classification === "AMBIGUOUS"
        ? "No single explicit intent established; owner review required."
        : `Explicit ${classification.toLowerCase()} wording detected.`,
    classifier_version: "commercial-rules-v1",
    human_review_required: confidence < 0.8,
  };
}
function schedule(
  state: FollowupState,
  c: Context,
  type: ActionType,
  due: string,
  reason: string,
  intention = "commercial_followup",
) {
  if (type === "NONE") return;
  for (const a of state.actions)
    if (a.intention === intention && a.status === "pending") {
      a.status = "cancelled";
      a.cancelled_at = c.now;
    }
  state.actions.push({
    id: `${c.eventId}:action${type === "PRE_CALL" ? ":pre_call" : ""}`,
    intention,
    action_type: type,
    due_at: instant(due),
    timezone: MARKETS[c.market].timezone,
    channel: ["CALL", "CALLBACK", "PRE_CALL"].includes(type) ? "phone" : "email",
    owner: c.owner,
    reason,
    source_event_id: c.eventId,
    status: "pending",
    created_at: c.now,
    completed_at: null,
    cancelled_at: null,
  });
}
function cancelBooking(state: FollowupState, id: string, now: string) {
  for (const b of state.bookings) if (b.id === id) {
    b.status = "cancelled";
    if (b.pre_call_status === "pending") b.pre_call_status = "cancelled";
  }
  for (const n of state.notifications)
    if (n.booking_id === id && n.status !== "CANCELLED") n.status = "CANCELLED";
  for (const a of state.actions)
    if ([`booking:${id}`, `pre_call:${id}`].includes(a.intention) && a.status === "pending") {
      a.status = "cancelled";
      a.cancelled_at = now;
    }
}
/** Human preparation only. No working-hours/dialer assumptions and never a demo gate. */
function schedulePreCall(state: FollowupState, booking: Booking, c: Context) {
  if (booking.pre_call_status && !["awaiting_demo_time", "skipped_due_to_short_notice"].includes(booking.pre_call_status)) return;
  if (!booking.start) { booking.pre_call_status = "awaiting_demo_time"; return; }
  const start = Date.parse(booking.start), now = Date.parse(c.now);
  if (start - now < 30 * 60000) { booking.pre_call_status = "skipped_due_to_short_notice"; return; }
  const due = Math.max(now + 5 * 60000, start - 24 * 3600000);
  booking.pre_call_status = "pending";
  schedule(state, c, "PRE_CALL", new Date(due).toISOString(), "Optional human pre-call; demo remains active even if skipped or unanswered", `pre_call:${booking.id}`);
}
export function notificationPreview(
  booking: Booking,
  kind: Notification["kind"],
  c: Context,
): Notification {
  const fr = c.market === "FR";
  const sms = kind.includes("sms");
  const pricing = kind === "pricing_email";
  const date = booking.start
    ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en-ZA", {
        timeZone: booking.timezone,
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date(booking.start))
    : "";
  const duration =
    booking.start && booking.end
      ? Math.round(
          (Date.parse(booking.end) - Date.parse(booking.start)) / 60000,
        )
      : 0;
  const due =
    booking.start && kind.includes("reminder")
      ? new Date(
          Date.parse(booking.start) - (sms ? 1 : 24) * 3600000,
        ).toISOString()
      : c.now;
  const reason =
    !pricing &&
    (!booking.start ||
      !booking.end ||
      !booking.meeting_url ||
      !booking.reschedule_url ||
      !booking.cancel_url)
      ? "booking_details_incomplete"
      : sms && !c.phone
        ? "verified_phone_missing"
        : !sms && !c.email
          ? "email_missing"
          : Date.parse(due) < Date.parse(c.now)
            ? "reminder_time_passed"
            : null;
  const subject = sms
    ? null
    : pricing
      ? fr
        ? "Merci pour notre échange — Boost My Businesses"
        : "Thanks for your time — Boost My Businesses"
      : fr
        ? "Votre démonstration Boost My Businesses est confirmée"
        : "Your Boost My Businesses demo is confirmed";
  const body = pricing
    ? fr
      ? `Bonjour,\nMerci pour notre échange.\nVoici les formules Boost My Businesses :\n${PRICING_URL}\nPayez 30 jours. Profitez-en pendant 45 jours.\n15 jours offerts sur votre premier mois.\nDémarrer maintenant : ${PRICING_URL}\nBoost My Businesses`
      : `Hi there,\nThanks for the conversation.\nYou can review Boost My Businesses plans here:\n${PRICING_URL}\nPay for 30 days. Get 45 days.\n15 extra days free with your first month.\nStart now: ${PRICING_URL}\nBoost My Businesses`
    : `${fr ? "Boost My Businesses — votre démo" : "Boost My Businesses — your demo"} ${kind.includes("reminder") ? (fr ? "(rappel)" : "(reminder)") : fr ? "est confirmée" : "is confirmed"}: ${date} (${booking.timezone}).${sms ? "" : `\n${fr ? "Durée" : "Duration"}: ${duration} min.`}\nGoogle Meet: ${booking.meeting_url ?? "[pending]"}\n${fr ? "Reprogrammer" : "Reschedule"}: ${booking.reschedule_url ?? "[pending]"}${sms ? "" : `\n${fr ? "Annuler" : "Cancel"}: ${booking.cancel_url ?? "[pending]"}\n${fr ? "Découvrez comment identifier et cibler les audiences Instagram pertinentes pour votre activité." : "See how to identify and target Instagram audiences relevant to your business."}`}`;
  return {
    id: `${booking.id}:${kind}`,
    booking_id: booking.id,
    kind,
    channel: sms ? "sms" : "email",
    due_at: due,
    status: reason ? "FAILED_CLOSED" : "READY_DRY_RUN",
    subject,
    body,
    reason,
  };
}
export function reduceFollowup(
  previous: FollowupState,
  command: Command,
  c: Context,
): { state: FollowupState; event: string } {
  instant(c.now);
  const state = structuredClone(previous);
  let event: string = command.kind;
  if (
    state.do_not_contact &&
    [
      "next_action",
      "call",
      "booking",
      "simulate_notification",
      "call_disposition",
    ].includes(command.kind)
  )
    throw new Error("do_not_contact");
  switch (command.kind) {
    case "pre_call_disposition": {
      const b = state.bookings.find(b => b.id === command.booking_id && b.status === "active");
      if (!b || !["completed", "no_answer", "skipped"].includes(command.disposition)) throw new Error("invalid_pre_call_disposition");
      b.pre_call_status = command.disposition;
      for (const a of state.actions) if (a.intention === `pre_call:${b.id}` && a.status === "pending") {
        a.status = command.disposition === "skipped" ? "cancelled" : "completed";
        if (a.status === "completed") a.completed_at = c.now; else a.cancelled_at = c.now;
      }
      event = "pre_call_disposition_set";
      break;
    }
    case "reply":
      if (state.replies.some((r) => r.id === command.reply.id))
        return { state, event: "duplicate_reply" };
      state.replies.push(command.reply);
      schedule(state, c, "REPLY", c.now, "New reply awaiting classification");
      event = "reply_received";
      break;
    case "classify": {
      const reply = state.replies.find((r) => r.id === command.reply_id);
      if (!reply) throw new Error("reply_not_found");
      if (reply.classification)
        return { state, event: "reply_already_classified" };
      Object.assign(reply, classifyReply(reply.raw_response));
      if (state.do_not_contact) return { state, event: "reply_classified" };
      const type = reply.classification;
      if (type === "DO_NOT_CONTACT" || type === "NOT_INTERESTED") {
        if (type === "DO_NOT_CONTACT") state.do_not_contact = true;
        for (const a of state.actions)
          if (a.status === "pending") {
            a.status = "cancelled";
            a.cancelled_at = c.now;
          }
        for (const n of state.notifications) n.status = "CANCELLED";
      } else {
        const action: ActionType =
          type === "BOOKING_INTENT"
            ? "BOOK_DEMO"
            : type === "REQUEST_CALL"
              ? "CALL"
              : type === "REQUEST_CALLBACK"
                ? "CALLBACK"
                : "REPLY";
        const fragment = /(?:tomorrow at|demain à) \d{1,2}:\d{2}/i.exec(
          reply.raw_response,
        )?.[0];
        const due = fragment
          ? callbackTime(fragment, reply.received_at, c.market)
          : null;
        schedule(
          state,
          c,
          action,
          due ?? c.now,
          type === "REQUEST_CALLBACK" && !due
            ? "Callback requested; owner must confirm date/time"
            : `${type}: ${reply.reasoning_safe}`,
        );
      }
      event = "reply_classified";
      break;
    }
    case "next_action":
      if (!ACTIONS.includes(command.action_type))
        throw new Error("invalid_action");
      schedule(
        state,
        c,
        command.action_type,
        command.due_at,
        command.reason,
        command.intention,
      );
      event = "next_action_rescheduled";
      break;
    case "action_status": {
      const action = state.actions.find((a) => a.id === command.action_id);
      if (!action) throw new Error("action_not_found");
      if (action.status !== "pending" && action.status !== command.status)
        throw new Error("action_already_terminal");
      action.status = command.status;
      if (action.action_type === "PRE_CALL") {
        const b = state.bookings.find(b => action.intention === `pre_call:${b.id}`);
        if (b) b.pre_call_status = command.status === "completed" ? "completed" : "skipped";
      }
      if (command.status === "completed") action.completed_at = c.now;
      else action.cancelled_at = c.now;
      event = `next_action_${command.status}`;
      break;
    }
    case "call":
      if (command.call.provider !== MARKETS[c.market].phoneProvider)
        throw new Error("call_market_mismatch");
      if (state.calls.some((a) => a.id === command.call.id))
        return { state, event: "call_duplicate_ignored" };
      state.calls.push(command.call);
      schedule(
        state,
        c,
        command.call.status === "ANSWERED" ? "REPLY" : "FOLLOW_UP",
        c.now,
        "Set human call disposition",
      );
      event =
        command.call.status === "ANSWERED" ? "call_completed" : "call_missed";
      break;
    case "call_disposition": {
      const call = state.calls.find((a) => a.id === command.call_id);
      if (!call) throw new Error("call_not_found");
      call.disposition = command.disposition;
      if (command.disposition === "CALLBACK" && !command.due_at)
        throw new Error("callback_due_required");
      for (const a of state.actions)
        if (a.status === "pending" && a.intention === "commercial_followup") {
          a.status = "completed";
          a.completed_at = c.now;
        }
      const type: ActionType =
        command.disposition === "INTERESTED"
          ? "BOOK_DEMO"
          : command.disposition === "CALLBACK"
            ? "CALLBACK"
            : command.disposition === "NO_ANSWER"
              ? "FOLLOW_UP"
              : command.disposition === "OTHER"
                ? "REPLY"
                : "NONE";
      schedule(
        state,
        c,
        type,
        command.due_at ?? c.now,
        command.disposition === "NO_ANSWER"
          ? "Owner to choose retry time; no market retry rule configured"
          : command.disposition,
      );
      event = "call_disposition_set";
      break;
    }
    case "booking": {
      const b = structuredClone(command.booking);
      const existing = state.bookings.find((a) => a.id === b.id);
      // Cancellation tombstones dominate late create deliveries.
      if (existing?.status === "cancelled" && b.status === "active")
        return { state, event: "booking_late_create_ignored" };
      if (existing && Date.parse(existing.updated_at) > Date.parse(b.updated_at))
        return { state, event: "booking_stale_event_ignored" };
      if (b.status === "cancelled") {
        if (!existing) state.bookings.push(b);
        else { existing.new_invitee = b.new_invitee ?? existing.new_invitee; existing.updated_at = b.updated_at; }
        cancelBooking(state, b.id, c.now);
        event = "calendly_booking_cancelled";
        break;
      }
      if (b.old_invitee) {
        if (!state.bookings.some((old) => old.id === b.old_invitee))
          state.bookings.push({
            ...b,
            id: b.old_invitee,
            event_uri: "",
            start: null,
            end: null,
            meeting_url: null,
            cancel_url: null,
            reschedule_url: null,
            status: "cancelled",
            old_invitee: null,
            new_invitee: b.id,
          });
        cancelBooking(state, b.old_invitee, c.now);
        const old = state.bookings.find(a => a.id === b.old_invitee)!;
        old.new_invitee = b.id;
        b.attribution = old.attribution ?? b.attribution;
      }
      if (state.bookings.some((a) => a.status === "active" && a.id !== b.id))
        throw new Error("concurrent_booking_requires_review");
      if (existing) Object.assign(existing, b, { attribution: existing.attribution ?? b.attribution, pre_call_status: existing.pre_call_status });
      else state.bookings.push(b);
      const current = state.bookings.find(a => a.id === b.id)!;
      schedulePreCall(state, current, c);
      for (const a of state.actions)
        if (a.status === "pending" && a.intention === "commercial_followup") {
          a.status = "completed";
          a.completed_at = c.now;
        }
      for (const kind of [
        "confirmation_email",
        "confirmation_sms",
        "reminder_email_24h",
        "reminder_sms_1h",
      ] as const) {
        const n = notificationPreview(b, kind, c);
        const old = state.notifications.find((a) => a.id === n.id);
        if (!old) state.notifications.push(n);
        else if (old.status === "FAILED_CLOSED") Object.assign(old, n);
      }
      schedule(
        state,
        c,
        "FOLLOW_UP",
        b.end ?? c.now,
        "Human demo disposition required",
        `booking:${b.id}`,
      );
      event = b.old_invitee
        ? "calendly_booking_rescheduled"
        : "calendly_booking_created";
      break;
    }
    case "demo_disposition": {
      const b = state.bookings.find(
        (a) => a.id === command.booking_id && a.status === "active",
      );
      if (!b) throw new Error("active_booking_required");
      if (!b.start || Date.parse(c.now) < Date.parse(b.start))
        throw new Error("demo_not_started");
      b.disposition = command.disposition;
      for (const a of state.actions)
        if ([`booking:${b.id}`, `pre_call:${b.id}`].includes(a.intention) && a.status === "pending") {
          a.status = "completed";
          a.completed_at = c.now;
        }
      if (b.pre_call_status === "pending") b.pre_call_status = "skipped";
      for (const n of state.notifications)
        if (n.booking_id === b.id) n.status = "CANCELLED";
      if (command.disposition === "INTERESTED" && !state.do_not_contact) {
        const n = notificationPreview(b, "pricing_email", c);
        const i = state.notifications.findIndex((a) => a.id === n.id);
        if (i < 0) state.notifications.push(n);
        else state.notifications[i] = n;
        schedule(
          state,
          c,
          "SEND_PRICING",
          c.now,
          "Demo completed + human interested disposition",
        );
      } else if (
        command.disposition === "FOLLOW_UP_NEEDED" ||
        command.disposition === "NO_SHOW"
      )
        schedule(state, c, "FOLLOW_UP", c.now, command.disposition);
      event =
        command.disposition === "NO_SHOW"
          ? "demo_no_show"
          : "demo_disposition_set";
      break;
    }
    case "simulate_notification": {
      const n = state.notifications.find(
        (a) => a.id === command.notification_id,
      );
      if (!n || n.status !== "READY_DRY_RUN")
        throw new Error("notification_not_ready");
      if (Date.parse(n.due_at) > Date.parse(c.now))
        throw new Error("notification_not_due");
      n.status = "SENT_SIMULATED";
      event = "notification_simulated";
      break;
    }
  }
  if (state.replies.length > 500 || state.actions.length > 2000)
    throw new Error("followup_capacity_requires_archival");
  return { state, event };
}
