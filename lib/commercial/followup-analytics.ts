import type { FollowupState } from "./followup-domain";
export type AnalyticsLead = {
  lead: {
    outreach_channel: string | null;
    message_angle: string | null;
    sales_status: string;
  };
  business: { country_code: string };
  state: FollowupState;
};
/** Lead-cohort rates, not event counts: duplicate calls/bookings cannot inflate conversion. */
function metrics(items: AnalyticsLead[], now: number) {
  const called = items.filter((i) => i.state.calls.length > 0);
  const demoDone = items.filter((i) =>
    i.state.bookings.some((b) => b.disposition && b.disposition !== "NO_SHOW"),
  );
  const interested = demoDone.filter((i) =>
    i.state.bookings.some((b) => b.disposition === "INTERESTED"),
  );
  const rate = (n: number, d: number) =>
    d ? Math.round((n / d) * 1000) / 10 : null;
  return {
    leads: items.length,
    replies: items.reduce((n, i) => n + i.state.replies.length, 0),
    positive_replies: items.reduce(
      (n, i) =>
        n +
        i.state.replies.filter((r) =>
          [
            "POSITIVE_INTEREST",
            "REQUEST_CALL",
            "REQUEST_CALLBACK",
            "BOOKING_INTENT",
          ].includes(r.classification ?? ""),
        ).length,
      0,
    ),
    calls_due: items.reduce(
      (n, i) =>
        n +
        i.state.actions.filter(
          (a) =>
            a.status === "pending" &&
            ["CALL", "CALLBACK"].includes(a.action_type) &&
            Date.parse(a.due_at) <= now,
        ).length,
      0,
    ),
    calls_completed: items.reduce((n, i) => n + i.state.calls.length, 0),
    call_to_demo_percent: rate(
      called.filter((i) => i.state.bookings.some((b) => b.status === "active"))
        .length,
      called.length,
    ),
    demos_booked: items.reduce(
      (n, i) =>
        n + i.state.bookings.filter((b) => b.status === "active").length,
      0,
    ),
    demos_completed: demoDone.length,
    no_show: items.filter((i) =>
      i.state.bookings.some((b) => b.disposition === "NO_SHOW"),
    ).length,
    demo_to_interested_percent: rate(interested.length, demoDone.length),
    interested_to_checkout_percent: rate(
      interested.filter((i) =>
        ["checkout_sent", "paid", "onboarding", "active_client"].includes(
          i.lead.sales_status,
        ),
      ).length,
      interested.length,
    ),
    paid: items.filter((i) =>
      ["paid", "onboarding", "active_client"].includes(i.lead.sales_status),
    ).length,
  };
}
export function followupAnalytics(items: AnalyticsLead[], now = Date.now()) {
  const group = (key: (item: AnalyticsLead) => string) =>
    Object.fromEntries(
      [...new Set(items.map(key))].sort().map((value) => [
        value,
        metrics(
          items.filter((i) => key(i) === value),
          now,
        ),
      ]),
    );
  return {
    cohort: "canonical_leads_with_followup_projection",
    total: metrics(items, now),
    market: group((i) => i.business.country_code),
    channel: group((i) => i.lead.outreach_channel ?? "unassigned"),
    angle: group((i) => i.lead.message_angle ?? "unassigned"),
    call_provider: Object.fromEntries(
      ["onoff", "local_manual"].map((provider) => [
        provider,
        metrics(
          items.filter((i) =>
            i.state.calls.some((call) => call.provider === provider),
          ),
          now,
        ),
      ]),
    ),
  };
}
