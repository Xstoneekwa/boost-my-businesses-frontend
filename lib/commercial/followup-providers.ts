import { createHmac, timingSafeEqual } from "node:crypto";
import {
  instant,
  normalizePhone,
  MARKETS,
  type Booking,
  type Call,
  type Market,
} from "./followup-domain";
export type Json = Record<string, unknown>;
export function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("object_required");
  return value as Json;
}
export function str(value: unknown, max = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("invalid_text");
  return value.trim();
}
function optional(value: unknown): string | null {
  return value === undefined || value === null ? null : str(value);
}
export function sameSecret(
  actual: string | null,
  expected: string | undefined,
): boolean {
  if (!actual || !expected || expected.length < 24) return false;
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function calendlySignature(
  body: string,
  header: string | null,
  secret: string | undefined,
  now = Date.now(),
): boolean {
  if (!header || !secret || secret.length < 24) return false;
  const t = /(?:^|,)t=(\d+)(?:,|$)/.exec(header)?.[1];
  const signatures = [
    ...header.matchAll(/(?:^|,)v1=([a-f0-9]{64})(?=,|$)/g),
  ].map((m) => m[1]);
  if (!t || Math.abs(now / 1000 - Number(t)) > 180) return false;
  const expected = createHmac("sha256", secret)
    .update(`${t}.${body}`)
    .digest("hex");
  return signatures.some((s) => sameSecret(s, expected));
}
export function safeProviderUrl(
  value: unknown,
  hosts: string[],
): string | null {
  if (value === undefined || value === null) return null;
  const url = new URL(str(value));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !hosts.includes(url.hostname)
  )
    throw new Error("provider_url_not_allowed");
  return url.href;
}
export function normalizeOnoff(
  value: unknown,
  sourceEventId: string,
): { call: Call; phone: string; safeRaw: Json; key: string } {
  const p = object(value);
  const id = str(p.id, 200);
  const event = str(p.eventName);
  if (!["CDR", "VM", "RECORDING"].includes(event))
    throw new Error("unsupported_onoff_event");
  const direction = str(p.callDirection);
  const status = str(p.callStatus);
  if (
    !["INBOUND", "OUTBOUND"].includes(direction) ||
    ![
      "MISSED_CALL",
      "ANSWERED",
      "BUSY",
      "WRONG_NUMBER",
      "VMS",
      "UNKNOWN",
    ].includes(status)
  )
    throw new Error("invalid_onoff_call");
  const phone = normalizePhone(str(p.externalNumber), "FR");
  if (!phone) throw new Error("invalid_external_number");
  const start = instant(str(p.callStarted)),
    end = instant(str(p.callEnded));
  if (end < start) throw new Error("invalid_call_times");
  const duration = p.callDuration == null ? null : Number(p.callDuration);
  if (duration !== null && (!Number.isInteger(duration) || duration < 0))
    throw new Error("invalid_duration");
  // Retain only allowlisted useful fields. Never fetch recordings or keep provider user email/notes.
  const recording = optional(p.callRecordingUrl);
  if (recording && new URL(recording).protocol !== "https:")
    throw new Error("unsafe_recording_url");
  return {
    key: `onoff:${id}:${event}`,
    phone,
    safeRaw: {
      id,
      eventName: event,
      externalNumber: phone,
      callDirection: direction,
      callStatus: status,
      callStarted: start,
      callEnded: end,
      callDuration: duration,
    },
    call: {
      id: `onoff:${id}`,
      provider: "onoff",
      direction: direction as Call["direction"],
      status,
      started_at: start,
      ended_at: end,
      duration,
      recording_reference: recording,
      source_event_id: sourceEventId,
    },
  };
}
export function normalizeCalendly(
  value: unknown,
  market: Market,
): { booking: Booking; email: string; key: string; safeRaw: Json } {
  const root = object(value),
    p = object(root.payload);
  const event = str(root.event);
  if (!["invitee.created", "invitee.canceled"].includes(event))
    throw new Error("unsupported_calendly_event");
  const id = safeProviderUrl(p.uri, ["api.calendly.com"]);
  const eventUri = safeProviderUrl(p.event, ["api.calendly.com"]);
  if (!id || !eventUri) throw new Error("calendly_identity_missing");
  const email = str(p.email, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("invalid_invitee_email");
  const scheduled = p.scheduled_event ? object(p.scheduled_event) : {};
  const location = scheduled.location ? object(scheduled.location) : {};
  const start = scheduled.start_time
      ? instant(str(scheduled.start_time))
      : null,
    end = scheduled.end_time ? instant(str(scheduled.end_time)) : null;
  if (start && end && end <= start) throw new Error("invalid_booking_times");
  const timezone = optional(p.timezone) ?? MARKETS[market].timezone;
  new Intl.DateTimeFormat("en", { timeZone: timezone });
  const booking: Booking = {
    id,
    event_uri: eventUri,
    start,
    end,
    timezone,
    meeting_url: location.join_url
      ? safeProviderUrl(location.join_url, ["meet.google.com"])
      : null,
    cancel_url: safeProviderUrl(p.cancel_url, ["calendly.com"]),
    reschedule_url: safeProviderUrl(p.reschedule_url, ["calendly.com"]),
    status: event === "invitee.canceled" ? "cancelled" : "active",
    old_invitee: safeProviderUrl(p.old_invitee, ["api.calendly.com"]),
    new_invitee: safeProviderUrl(p.new_invitee, ["api.calendly.com"]),
    updated_at: instant(str(root.created_at)),
    questions_and_answers: Array.isArray(p.questions_and_answers) ? p.questions_and_answers.slice(0, 20).map(value => {
      const answer = object(value);
      return { question: str(answer.question, 500), answer: str(answer.answer, 2000) };
    }) : [],
  };
  return {
    booking,
    email,
    key: `calendly:${event}:${id}`,
    safeRaw: {
      event,
      created_at: root.created_at,
      invitee_uri: id,
      event_uri: eventUri,
      email,
      old_invitee: booking.old_invitee,
      new_invitee: booking.new_invitee,
    },
  };
}
