import { createSupabaseClient } from "@/lib/supabase";
import { requireInstagramAdmin, jsonError, jsonOk, readString } from "../../../_utils";
import { resolveAccountSnapshotTimezone } from "@/lib/instagram-dashboard/social-profile-snapshot-service";
import { businessDayKeyFromIso } from "@/lib/instagram-dashboard/business-timezone";
import { socialProfileSnapshotIdempotencyKey } from "@/lib/instagram-dashboard/social-profile-snapshot-contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ accountId: string }> }) {
  const unauthorized = await requireInstagramAdmin();
  if (unauthorized) return unauthorized;
  const { accountId } = await context.params;
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) return jsonError("Missing account id.", 400);
  const supabase = createSupabaseClient();
  const account = await supabase.from("ig_accounts").select("id,username").eq("id", normalizedAccountId).maybeSingle();
  if (account.error || !account.data?.id) return jsonError("Account not found.", 404);
  const cooldownSince = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const recent = await supabase.from("ig_social_profile_snapshot_jobs")
    .select("id,status,created_at")
    .eq("account_id", normalizedAccountId)
    .eq("source_trigger", "admin_manual_refresh")
    .gte("created_at", cooldownSince)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent.data?.id) return jsonError("Refresh cooldown active.", 429, { retry_after_seconds: 21600 });
  const now = new Date().toISOString();
  const resolved = await resolveAccountSnapshotTimezone(supabase, normalizedAccountId);
  const sourceEventId = crypto.randomUUID();
  const insert = await supabase.from("ig_social_profile_snapshot_jobs").insert({
    account_id: normalizedAccountId,
    username_normalized: readString(account.data.username, "").trim().toLowerCase(),
    snapshot_local_date: businessDayKeyFromIso(now, resolved.timezone),
    account_timezone: resolved.timezone,
    timezone_source: resolved.source,
    source_trigger: "admin_manual_refresh",
    source_event_id: sourceEventId,
    idempotency_key: socialProfileSnapshotIdempotencyKey({
      accountId: normalizedAccountId,
      trigger: "admin_manual_refresh",
      observedAt: now,
      timezone: resolved.timezone,
      sourceEventId,
    }),
  }).select("id,status,created_at").single();
  if (insert.error) return jsonError(insert.error.message, 500);
  return jsonOk({ job: insert.data, provider_call_started: false });
}
