import { createSupabaseClient } from "@/lib/supabase";
import { requireInstagramAdmin, jsonError, jsonOk, readString } from "../../../_utils";
import {
  guardSocialProfileSnapshotJob,
  resolveAccountSnapshotTimezone,
} from "@/lib/instagram-dashboard/social-profile-snapshot-service";
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
  const now = new Date();
  const nowIso = now.toISOString();
  const resolved = await resolveAccountSnapshotTimezone(supabase, normalizedAccountId);
  const sourceEventId = crypto.randomUUID();
  const idempotencyKey = socialProfileSnapshotIdempotencyKey({
      accountId: normalizedAccountId,
      trigger: "admin_manual_refresh",
      observedAt: nowIso,
      timezone: resolved.timezone,
      sourceEventId,
    });
  const guarded = await guardSocialProfileSnapshotJob({
    accountId: normalizedAccountId,
    username: readString(account.data.username, ""),
    snapshotLocalDate: businessDayKeyFromIso(nowIso, resolved.timezone),
    accountTimezone: resolved.timezone,
    timezoneSource: resolved.source,
    trigger: "admin_manual_refresh",
    idempotencyKey,
    sourceEventId,
    explicitAdminRefresh: true,
    now,
    supabase,
  });
  if (guarded.reason === "admin_refresh_cooldown") {
    return jsonError("Refresh cooldown active.", 429, { retry_after_seconds: 21600 });
  }
  if (guarded.classification === "terminal_suppressed") {
    return jsonError("Refresh could not be queued.", 409, { reason: guarded.reason });
  }
  return jsonOk({
    job: { id: guarded.jobId, status: guarded.jobStatus, created: guarded.created },
    classification: guarded.classification,
    provider_call_started: false,
  });
}
