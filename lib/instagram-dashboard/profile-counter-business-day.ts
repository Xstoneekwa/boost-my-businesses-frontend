import {
  businessDayWindow,
  DEFAULT_BUSINESS_TIMEZONE,
} from "./business-timezone.ts";

/** Canonical lower bound for dashboard "today" action counters. */
export function profileCounterBusinessDayStartIso(
  now = new Date(),
  timezone = DEFAULT_BUSINESS_TIMEZONE,
) {
  return businessDayWindow(now, timezone).startIso;
}
