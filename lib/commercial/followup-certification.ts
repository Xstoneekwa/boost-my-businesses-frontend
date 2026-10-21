import {
  emptyFollowup,
  reduceFollowup,
  TRANSPORTS,
  type Booking,
  type Context,
  type Command,
} from "./followup-domain";
import { normalizeOnoff } from "./followup-providers";
/** Synthetic in-memory fixtures only. No CRM writes, provider API or transport. */
export function certifyFollowupFixtures() {
  const checks: Record<string, boolean> = {};
  for (const market of ["FR", "ZA"] as const) {
    let sequence = 0;
    const context: Context = {
      market,
      owner: "fixture-owner",
      now: "2026-09-08T10:00:00.000Z",
      eventId: "fixture",
      email: "fixture@example.invalid",
      phone: market === "FR" ? "+33600000000" : "+27820000000",
    };
    let state = emptyFollowup();
    const apply = (command: Command) => {
      state = reduceFollowup(state, command, {
        ...context,
        eventId: `fixture-${++sequence}`,
      }).state;
    };
    apply({
      kind: "reply",
      reply: {
        id: "fixture-reply",
        raw_response: "Can you call me?",
        channel: "email",
        source_message_id: "fixture-message",
        conversation_id: "fixture-conversation",
        contact_id: null,
        outreach_item_id: null,
        received_at: context.now,
        classification: null,
        confidence: null,
        reasoning_safe: null,
        classifier_version: null,
        human_review_required: true,
      },
    });
    checks[`${market}_reply_needs_review_before_classification`] =
      state.actions.some(
        (a) => a.status === "pending" && a.action_type === "REPLY",
      );
    apply({ kind: "classify", reply_id: "fixture-reply" });
    checks[`${market}_human_call_recommended`] = state.actions.some(
      (a) => a.status === "pending" && a.action_type === "CALL",
    );
    const call = normalizeOnoff(
      {
        id: "synthetic-call",
        eventName: "CDR",
        externalNumber: "+33600000000",
        callStarted: context.now,
        callEnded: "2026-09-08T10:02:00Z",
        callDirection: "OUTBOUND",
        callStatus: "ANSWERED",
        callDuration: 120,
      },
      "fixture-call",
    ).call;
    apply({
      kind: "call",
      call: { ...call, provider: market === "FR" ? "onoff" : "local_manual" },
    });
    apply({
      kind: "call_disposition",
      call_id: call.id,
      disposition: "INTERESTED",
    });
    checks[`${market}_no_pricing_after_call`] =
      state.notifications.length === 0;
    const b: Booking = {
      id: "fixture-booking",
      event_uri: "https://api.calendly.com/scheduled_events/fixture",
      start: "2026-09-10T10:00:00Z",
      end: "2026-09-10T10:30:00Z",
      timezone: market === "FR" ? "Europe/Paris" : "Africa/Johannesburg",
      meeting_url: "https://meet.google.com/aaa-bbbb-ccc",
      cancel_url: "https://calendly.com/cancellations/fixture",
      reschedule_url: "https://calendly.com/reschedulings/fixture",
      status: "active",
      old_invitee: null,
      new_invitee: null,
      updated_at: context.now,
    };
    apply({ kind: "booking", booking: b });
    checks[`${market}_four_notifications_dry_run`] =
      state.notifications.filter((n) => n.status === "READY_DRY_RUN").length ===
      4;
    apply({
      kind: "booking",
      booking: {
        ...b,
        id: "fixture-rescheduled",
        old_invitee: b.id,
        meeting_url: "https://meet.google.com/ddd-eeee-fff",
      },
    });
    apply({
      kind: "booking",
      booking: {
        ...b,
        status: "cancelled",
        new_invitee: "fixture-rescheduled",
      },
    });
    checks[`${market}_reschedule_cancels_old_reminders`] = state.notifications
      .filter((n) => n.booking_id === b.id)
      .every((n) => n.status === "CANCELLED");
    checks[`${market}_one_active_demo`] =
      state.bookings.filter((b) => b.status === "active").length === 1;
    context.now = "2026-09-10T11:00:00Z";
    apply({
      kind: "demo_disposition",
      booking_id: "fixture-rescheduled",
      disposition: "INTERESTED",
    });
    checks[`${market}_pricing_after_human_demo`] =
      state.notifications.filter(
        (n) => n.kind === "pricing_email" && n.status === "READY_DRY_RUN",
      ).length === 1;
  }
  return {
    mode: "SYNTHETIC_IN_MEMORY_ONLY",
    passed: Object.values(checks).every(Boolean),
    checks,
    crm_writes: 0,
    real_contacts: 0,
    openai_calls: 0,
    transports: TRANSPORTS,
  };
}
