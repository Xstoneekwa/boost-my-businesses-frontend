import {
  businessDayKeyFromIso,
  DEFAULT_BUSINESS_TIMEZONE,
  zonedLocalDateTimeToUtc,
} from "./business-timezone.ts";

/** Canonical lower bound for dashboard "today" action counters. */
export function profileCounterBusinessDayStartIso(
  now = new Date(),
  timezone = DEFAULT_BUSINESS_TIMEZONE,
) {
  const businessDay = businessDayKeyFromIso(now.toISOString(), timezone);
  if (!businessDay) throw new Error("profile_counter_business_day_invalid");
  return zonedLocalDateTimeToUtc(businessDay, "00:00", timezone).toISOString();
}
