export type MockRecentInteraction = {
  time: string;
  title: string;
  detail: string;
  status: string;
  tone: "good" | "warning" | "neutral";
};

export type MockUpcomingReservation = {
  time: string;
  guest: string;
  partySize: number;
  source: string;
  status: string;
};

export type MockTopSourceMetric = {
  source: string;
  value: number;
  conversion: number;
};

export type MockRestaurantDashboardExtras = {
  recentInteractions: MockRecentInteraction[];
  upcomingReservations: MockUpcomingReservation[];
  topSources: MockTopSourceMetric[];
};

export const mockRestaurantDashboardRows: Record<string, unknown>[] = [
  {
    tenant_id: "demo-tenant-bella-vista",
    tenant_name: "Bella Vista Restaurant",
    tenant_slug: "bella-vista",
    plan: "enterprise",
    location_id: "demo-location-waterfront",
    location_name: "Bella Vista Waterfront",
    total_calls: 428,
    total_reservations: 164,
    total_escalations: 18,
    call_to_booking_rate: 38.3,
    quota_usage_percent: 74,
    sms_followups_sent: 119,
    whatsapp_followups_sent: 246,
    failed_followups: 7,
    estimated_revenue_eur: 19680,
    estimated_revenue_zar: 397536,
    estimated_followup_recovered_revenue_eur: 6240,
    estimated_followup_recovered_revenue_zar: 126048,
    pending_reservations: 22,
    cancelled_reservations: 9,
    no_show_reservations: 4,
  },
  {
    tenant_id: "demo-tenant-bella-vista",
    tenant_name: "Bella Vista Restaurant",
    tenant_slug: "bella-vista",
    plan: "enterprise",
    location_id: "demo-location-gardens",
    location_name: "Bella Vista Gardens",
    total_calls: 286,
    total_reservations: 103,
    total_escalations: 11,
    call_to_booking_rate: 36,
    quota_usage_percent: 74,
    sms_followups_sent: 86,
    whatsapp_followups_sent: 172,
    failed_followups: 5,
    estimated_revenue_eur: 12360,
    estimated_revenue_zar: 249672,
    estimated_followup_recovered_revenue_eur: 3880,
    estimated_followup_recovered_revenue_zar: 78376,
    pending_reservations: 15,
    cancelled_reservations: 6,
    no_show_reservations: 3,
  },
  {
    tenant_id: "demo-tenant-bella-vista",
    tenant_name: "Bella Vista Restaurant",
    tenant_slug: "bella-vista",
    plan: "enterprise",
    location_id: "demo-location-vineyard",
    location_name: "Bella Vista Vineyard",
    total_calls: 192,
    total_reservations: 71,
    total_escalations: 8,
    call_to_booking_rate: 37,
    quota_usage_percent: 74,
    sms_followups_sent: 61,
    whatsapp_followups_sent: 124,
    failed_followups: 4,
    estimated_revenue_eur: 8520,
    estimated_revenue_zar: 172104,
    estimated_followup_recovered_revenue_eur: 2760,
    estimated_followup_recovered_revenue_zar: 55752,
    pending_reservations: 11,
    cancelled_reservations: 4,
    no_show_reservations: 2,
  },
];

export const mockRestaurantDashboardExtras: MockRestaurantDashboardExtras = {
  recentInteractions: [
    {
      time: "19:42",
      title: "Private dining request",
      detail: "AI captured a 12-person birthday booking and flagged a deposit question.",
      status: "Escalated",
      tone: "warning",
    },
    {
      time: "19:18",
      title: "WhatsApp follow-up recovered booking",
      detail: "Guest confirmed Friday dinner for 4 after missing the first call.",
      status: "Recovered",
      tone: "good",
    },
    {
      time: "18:57",
      title: "Peak-hour call handled",
      detail: "AI answered allergy questions and captured terrace seating preference.",
      status: "Booked",
      tone: "good",
    },
  ],
  upcomingReservations: [
    { time: "20:00", guest: "Amelia R.", partySize: 6, source: "Voice AI", status: "Confirmed" },
    { time: "20:30", guest: "Marcus D.", partySize: 4, source: "WhatsApp follow-up", status: "Confirmed" },
    { time: "21:00", guest: "Priya N.", partySize: 10, source: "Escalation", status: "Pending deposit" },
  ],
  topSources: [
    { source: "Voice AI calls", value: 238, conversion: 39.6 },
    { source: "WhatsApp follow-ups", value: 71, conversion: 18.4 },
    { source: "SMS follow-ups", value: 29, conversion: 9.7 },
    { source: "Human escalations", value: 18, conversion: 62.1 },
  ],
};
