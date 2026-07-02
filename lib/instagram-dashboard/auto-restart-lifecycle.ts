import type { SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  insert: (...args: unknown[]) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
  limit: (...args: unknown[]) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function query(supabase: SupabaseLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

export type PhoneRestOverride = {
  deviceId: string;
  status: "paused" | "resumed";
  reason: string;
  updatedAt: string | null;
};

export function phoneRestOverrideBlocksRestart(override: PhoneRestOverride | undefined) {
  return override?.status === "paused";
}

export async function listPhoneRestOverrides(supabase: SupabaseLike): Promise<Map<string, PhoneRestOverride>> {
  const result = await query(supabase, "phone_rest_overrides").select("device_id,status,reason,updated_at").limit(1000);
  if (result.error) throw new Error(result.error.message || "phone_rest_overrides_unavailable");
  const rows = Array.isArray(result.data) ? result.data as SupabaseRecord[] : [];
  const map = new Map<string, PhoneRestOverride>();
  for (const row of rows) {
    const deviceId = readString(row.device_id);
    if (!deviceId) continue;
    const status = readString(row.status, "paused") as PhoneRestOverride["status"];
    map.set(deviceId, {
      deviceId,
      status: status === "resumed" ? "resumed" : "paused",
      reason: readString(row.reason, ""),
      updatedAt: readString(row.updated_at) || null,
    });
  }
  return map;
}

export async function cancelPendingAutoRestartRequests(
  supabase: SupabaseLike,
  input: { actor: string; requestId: string },
) {
  const activeStatuses = ["queued", "claimed", "starting"];
  const result = await query(supabase, "account_run_requests")
    .select("id,account_id,status,metadata_safe,source_surface")
    .in("status", activeStatuses)
    .limit(500);
  if (result.error) throw new Error(result.error.message || "account_run_requests_unavailable");
  const rows = Array.isArray(result.data) ? result.data as SupabaseRecord[] : [];
  const canceled: string[] = [];
  for (const row of rows) {
    const metadata = row.metadata_safe && typeof row.metadata_safe === "object" && !Array.isArray(row.metadata_safe)
      ? row.metadata_safe as SupabaseRecord
      : {};
    const source = readString(row.source_surface, "");
    const autoRestart = Boolean(metadata.auto_restart) || source === "auto_restart_tick";
    if (!autoRestart) continue;
    const requestId = readString(row.id);
    if (!requestId) continue;
    const { error } = await supabase.rpc("cancel_account_run_request", {
      p_request_id: requestId,
      p_reason: "auto_restart_disabled_before_claim",
    });
    if (!error) canceled.push(requestId);
    await query(supabase, "auto_restart_decisions").insert({
      request_id: input.requestId,
      idempotency_key: `auto-restart-disable:${requestId}`,
      actor: input.actor,
      account_id: readString(row.account_id) || null,
      action: "auto_restart_disabled_before_claim",
      decision: "canceled",
      reason: "auto_restart_disabled_before_claim",
      mode: "disabled",
      metadata_safe: { canceled_request_id: requestId },
    });
  }
  return { canceled_count: canceled.length, canceled_request_ids: canceled };
}

export async function listActiveDeviceLocks(supabase: SupabaseLike): Promise<Set<string>> {
  const nowIso = new Date().toISOString();
  const result = await query(supabase, "auto_restart_device_locks")
    .select("device_id,lease_expires_at")
    .limit(500);
  if (result.error) throw new Error(result.error.message || "auto_restart_device_locks_unavailable");
  const rows = Array.isArray(result.data) ? result.data as SupabaseRecord[] : [];
  const locked = new Set<string>();
  for (const row of rows) {
    const deviceId = readString(row.device_id);
    const lease = readString(row.lease_expires_at);
    if (deviceId && lease && lease > nowIso) locked.add(deviceId);
  }
  return locked;
}
