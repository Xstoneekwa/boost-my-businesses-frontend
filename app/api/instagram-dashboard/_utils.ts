import { NextResponse } from "next/server";
import { canAccessTenantPages, getDashboardUserContext } from "@/lib/restaurant-analytics/session";

export type SupabaseRecord = Record<string, unknown>;

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function jsonError(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function canBypassInstagramAdminLocally() {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return process.env.NODE_ENV === "development" || process.env.INSTAGRAM_DASHBOARD_LOCAL_ADMIN === "true";
}

export async function requireInstagramAdmin() {
  if (canBypassInstagramAdminLocally()) {
    return null;
  }

  const userContext = await getDashboardUserContext();

  if (!userContext) {
    return jsonError("Authentication required.", 401);
  }

  if (!canAccessTenantPages(userContext)) {
    return jsonError("You are not authorized to access the Instagram dashboard.", 403);
  }

  return null;
}

export function getAccountId(request: Request) {
  const url = new URL(request.url);
  return url.searchParams.get("account_id")?.trim() ?? "";
}

export function validateAccountId(accountId: string) {
  if (!accountId) {
    return jsonError("Missing account_id.", 400);
  }

  return null;
}

export function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

export function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function readInteger(value: unknown, fallback = 0) {
  return Math.trunc(readNumber(value, fallback));
}

export function readDate(value: unknown) {
  const raw = readString(value, "");
  if (!raw) return "—";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export async function readJsonBody<T>(request: Request): Promise<T | null> {
  const text = await request.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
