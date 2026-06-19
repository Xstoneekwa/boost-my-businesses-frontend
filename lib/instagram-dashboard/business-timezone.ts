export const DEFAULT_BUSINESS_TIMEZONE = "Africa/Johannesburg";

export const STANDARD_BUSINESS_SLOTS_LOCAL = [
  { label: "00:00-06:00", start: "00:00", end: "06:00" },
  { label: "06:00-12:00", start: "06:00", end: "12:00" },
  { label: "12:00-18:00", start: "12:00", end: "18:00" },
  { label: "18:00-00:00", start: "18:00", end: "00:00" },
] as const;

export function normalizeBusinessTimezone(timezone?: string | null) {
  const value = String(timezone || "").trim();
  return value || DEFAULT_BUSINESS_TIMEZONE;
}

export function normalizeLegacyScheduleTimezone(timezone?: string | null) {
  const value = String(timezone || "").trim();
  // UTC is the legacy DB default for phone_devices; schedule surfaces use the business default.
  return value && value !== "UTC" ? value : DEFAULT_BUSINESS_TIMEZONE;
}

export function zonedDateParts(date: Date, timezone = DEFAULT_BUSINESS_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeBusinessTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

export function businessDayKeyFromIso(value: string, timezone = DEFAULT_BUSINESS_TIMEZONE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedDateParts(date, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function businessMonthKeyFromIso(value: string, timezone = DEFAULT_BUSINESS_TIMEZONE) {
  const dayKey = businessDayKeyFromIso(value, timezone);
  return dayKey ? dayKey.slice(0, 7) : "";
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

export function zonedLocalDateTimeToUtc(
  localDate: string,
  localTime: string,
  timezone = DEFAULT_BUSINESS_TIMEZONE,
) {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute || 0, 0, 0);
  let guess = targetUtc;
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(new Date(guess), timezone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    guess -= asUtc - targetUtc;
  }
  return new Date(guess);
}

function addLocalDays(localDate: string, days: number) {
  const [year, month, day] = localDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0, 0));
  return utc.toISOString().slice(0, 10);
}

export function standardBusinessSlotsForLocalDate(
  localDate: string,
  timezone = DEFAULT_BUSINESS_TIMEZONE,
) {
  return STANDARD_BUSINESS_SLOTS_LOCAL.map((slot) => {
    const endDate = slot.end === "00:00" ? addLocalDays(localDate, 1) : localDate;
    return {
      ...slot,
      timezone,
      starts_at: zonedLocalDateTimeToUtc(localDate, slot.start, timezone).toISOString(),
      ends_at: zonedLocalDateTimeToUtc(endDate, slot.end, timezone).toISOString(),
    };
  });
}
