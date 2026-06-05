import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./business-timezone.ts", import.meta.url), "utf8");

function zonedParts(date, timezone) {
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
  const read = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

function zonedLocalDateTimeToUtc(localDate, localTime, timezone = "Africa/Johannesburg") {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute || 0, 0, 0);
  let guess = targetUtc;
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(new Date(guess), timezone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    guess -= asUtc - targetUtc;
  }
  return new Date(guess).toISOString();
}

function addLocalDays(localDate, days) {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0, 0)).toISOString().slice(0, 10);
}

function standardBusinessSlotsForLocalDate(localDate) {
  return [
    ["00:00-06:00", "00:00", "06:00"],
    ["06:00-12:00", "06:00", "12:00"],
    ["12:00-18:00", "12:00", "18:00"],
    ["18:00-00:00", "18:00", "00:00"],
  ].map(([label, start, end]) => {
    const endDate = end === "00:00" ? addLocalDays(localDate, 1) : localDate;
    return [label, zonedLocalDateTimeToUtc(localDate, start), zonedLocalDateTimeToUtc(endDate, end)];
  });
}

function formatLocal(startsAt, endsAt, timezone = "Africa/Johannesburg") {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  });
  return `${formatter.format(new Date(startsAt))} - ${formatter.format(new Date(endsAt))}`;
}

test("business timezone helper centralizes Johannesburg defaults", () => {
  assert.match(source, /DEFAULT_BUSINESS_TIMEZONE = "Africa\/Johannesburg"/);
  assert.match(source, /STANDARD_BUSINESS_SLOTS_LOCAL/);
  assert.match(source, /normalizeBusinessTimezone/);
  assert.match(source, /normalizeLegacyScheduleTimezone/);
});

test("standard Johannesburg slots convert to UTC without off-by-two-hours", () => {
  assert.deepEqual(standardBusinessSlotsForLocalDate("2026-06-05"), [
    ["00:00-06:00", "2026-06-04T22:00:00.000Z", "2026-06-05T04:00:00.000Z"],
    ["06:00-12:00", "2026-06-05T04:00:00.000Z", "2026-06-05T10:00:00.000Z"],
    ["12:00-18:00", "2026-06-05T10:00:00.000Z", "2026-06-05T16:00:00.000Z"],
    ["18:00-00:00", "2026-06-05T16:00:00.000Z", "2026-06-05T22:00:00.000Z"],
  ]);
});

test("existing UTC assignment records render as Johannesburg local windows", () => {
  assert.equal(formatLocal("2026-06-05T10:00:00.000Z", "2026-06-05T16:00:00.000Z"), "12:00 - 18:00");
  assert.equal(formatLocal("2026-06-05T16:00:00.000Z", "2026-06-05T22:00:00.000Z"), "18:00 - 00:00");
  assert.equal(formatLocal("2026-06-05T12:00:00.000Z", "2026-06-05T18:00:00.000Z"), "14:00 - 20:00");
});
