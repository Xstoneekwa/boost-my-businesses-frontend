import { randomUUID } from "node:crypto";
import { loadTargetEligibilityCountsByAccount } from "./account-target-eligibility.ts";
import { createPostmarkClientEmailAdapter } from "./client-email-postmark-adapter.ts";
import { CLIENT_EMAIL_POSTMARK_STREAM } from "./client-email-provider.ts";
import { evaluateNeedsMoreDispatchAutomationGate } from "./client-email-needs-more-targets-automation-config.ts";
import {
  loadActiveNeedsMoreTargetAccountsAction,
  NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
} from "./needs-more-target-accounts.ts";
import { isIntentRecipientSuppressed } from "./client-email-recipient-suppression.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

type SupabaseRecord = Record<string, unknown>;

const DISPATCHABLE_STATUSES = ["pending", "scheduled"] as const;
const MAX_DISPATCH_ATTEMPTS = 8;
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const DISPATCH_BATCH_LIMIT = 20;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type DispatchRevalidationFailure = {
  ok: false;
  cancel: true;
  reason: string;
};

export type DispatchRevalidationSuccess = {
  ok: true;
};

export type DispatchRevalidationResult = DispatchRevalidationFailure | DispatchRevalidationSuccess;

export async function revalidateNeedsMoreDispatchIntent(
  supabase: ClientEmailSupabase,
  intent: SupabaseRecord,
  now: Date,
): Promise<DispatchRevalidationResult> {
  const accountId = readString(intent.account_id, "");
  const clientId = readString(intent.client_id, "");
  const category = readString(intent.category, "");
  if (!accountId || !clientId || category !== "needs_more_target_accounts") {
    return { ok: false, cancel: true, reason: "invalid_intent_scope" };
  }

  const { data: link, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("client_id")
    .eq("account_id", accountId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (linkError) throw new Error(linkError.message);
  if (!link) {
    return { ok: false, cancel: true, reason: "tenant_account_mismatch" };
  }

  const eligibility = await loadTargetEligibilityCountsByAccount(supabase, [accountId]);
  const eligibleTargetCount = eligibility.get(accountId)?.eligible ?? 0;
  if (eligibleTargetCount > NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD) {
    return { ok: false, cancel: true, reason: "eligible_targets_above_threshold" };
  }

  const activeAction = await loadActiveNeedsMoreTargetAccountsAction(supabase, accountId);
  if (!activeAction?.id) {
    return { ok: false, cancel: true, reason: "needs_more_signal_inactive" };
  }

  const recipientEmail = readString(intent.recipient_email, "");
  if (!recipientEmail) {
    return { ok: false, cancel: true, reason: "missing_recipient_email" };
  }

  const intentId = readString(intent.id, "");
  if (await isIntentRecipientSuppressed(supabase, intentId)) {
    return { ok: false, cancel: true, reason: "recipient_suppressed" };
  }

  const scheduledFor = readString(intent.scheduled_for, "");
  if (scheduledFor) {
    const scheduledMs = new Date(scheduledFor).getTime();
    if (!Number.isNaN(scheduledMs) && scheduledMs > now.getTime()) {
      return { ok: false, cancel: true, reason: "not_yet_scheduled" };
    }
  }

  void now;
  return { ok: true };
}

export async function claimNeedsMoreDispatchIntent(
  supabase: ClientEmailSupabase,
  intentId: string,
  now: Date,
): Promise<SupabaseRecord | null> {
  const claimToken = randomUUID();
  const claimExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();
  const nowIso = now.toISOString();

  const { data: current, error: readError } = await supabase
    .from("client_email_send_intents")
    .select("*")
    .eq("id", intentId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) return null;

  const row = current as SupabaseRecord;
  const status = readString(row.status, "");
  const providerMessageId = readString(row.provider_message_id, "");
  if (providerMessageId) return null;
  if (!DISPATCHABLE_STATUSES.includes(status as typeof DISPATCHABLE_STATUSES[number])) return null;

  const existingClaimExpires = readString(row.claim_expires_at, "");
  const existingClaimMs = existingClaimExpires ? new Date(existingClaimExpires).getTime() : 0;
  if (status === "claimed" && existingClaimMs > now.getTime()) return null;

  const attemptCount = readNumber(row.dispatch_attempt_count, 0);
  const { data, error } = await supabase
    .from("client_email_send_intents")
    .update({
      status: "claimed",
      claimed_at: nowIso,
      claim_token: claimToken,
      claim_expires_at: claimExpiresAt,
      dispatch_attempt_count: attemptCount + 1,
      dispatch_last_attempt_at: nowIso,
    })
    .eq("id", intentId)
    .in("status", [...DISPATCHABLE_STATUSES])
    .is("provider_message_id", null)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SupabaseRecord | null) ?? null;
}

export async function cancelDispatchIntent(
  supabase: ClientEmailSupabase,
  intentId: string,
  reason: string,
  now: Date,
) {
  const nowIso = now.toISOString();
  const { error } = await supabase
    .from("client_email_send_intents")
    .update({
      status: "canceled",
      resolved_at: nowIso,
      claim_token: null,
      claim_expires_at: null,
      dispatch_last_error_code: reason.slice(0, 120),
    })
    .eq("id", intentId)
    .in("status", ["pending", "scheduled", "claimed"]);
  if (error) throw new Error(error.message);
}

export async function finalizeDispatchIntentSent(
  supabase: ClientEmailSupabase,
  intentId: string,
  providerMessageId: string,
  now: Date,
) {
  const nowIso = now.toISOString();
  const { error } = await supabase
    .from("client_email_send_intents")
    .update({
      status: "sent",
      sent_at: nowIso,
      provider_accepted_at: nowIso,
      provider_message_id: providerMessageId,
      claim_token: null,
      claim_expires_at: null,
      dispatch_last_error_code: null,
    })
    .eq("id", intentId)
    .eq("status", "claimed");
  if (error) throw new Error(error.message);
}

export async function finalizeDispatchIntentFailed(
  supabase: ClientEmailSupabase,
  intentId: string,
  errorCode: string,
  now: Date,
  input: { attemptCount: number; releaseForRetry: boolean },
) {
  const nowIso = now.toISOString();
  const terminal = !input.releaseForRetry || input.attemptCount >= MAX_DISPATCH_ATTEMPTS;
  const { error } = await supabase
    .from("client_email_send_intents")
    .update({
      status: terminal ? "failed" : "pending",
      resolved_at: terminal ? nowIso : null,
      claim_token: null,
      claim_expires_at: null,
      dispatch_last_error_code: errorCode.slice(0, 120),
    })
    .eq("id", intentId)
    .eq("status", "claimed");
  if (error) throw new Error(error.message);
}

export async function finalizeDispatchIntentUncertain(
  supabase: ClientEmailSupabase,
  intentId: string,
  errorCode: string,
  now: Date,
) {
  const nowIso = now.toISOString();
  const { error } = await supabase
    .from("client_email_send_intents")
    .update({
      status: "dispatch_uncertain",
      dispatch_uncertain_at: nowIso,
      claim_token: null,
      claim_expires_at: null,
      dispatch_last_error_code: errorCode.slice(0, 120),
    })
    .eq("id", intentId)
    .eq("status", "claimed");
  if (error) throw new Error(error.message);
}

export async function listNeedsMoreDispatchCandidates(
  supabase: ClientEmailSupabase,
  now: Date,
  limit = DISPATCH_BATCH_LIMIT,
) {
  const nowIso = now.toISOString();
  const { data, error } = await supabase
    .from("client_email_send_intents")
    .select("*")
    .eq("category", "needs_more_target_accounts")
    .eq("intent_kind", "client")
    .in("status", [...DISPATCHABLE_STATUSES])
    .is("provider_message_id", null)
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SupabaseRecord[];
}

export type DispatchIntentResult =
  | { outcome: "skipped"; reason: string }
  | { outcome: "canceled"; reason: string }
  | { outcome: "submitted"; intentId: string; providerMessageId: string }
  | { outcome: "failed"; intentId: string; reason: string }
  | { outcome: "dispatch_uncertain"; intentId: string; reason: string };

export async function dispatchSingleNeedsMoreIntent(
  supabase: ClientEmailSupabase,
  intentRow: SupabaseRecord,
  input: {
    env?: Record<string, string | undefined>;
    now?: Date;
    fetcher?: typeof fetch;
  } = {},
): Promise<DispatchIntentResult> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const dispatchGate = evaluateNeedsMoreDispatchAutomationGate(env);
  if (!dispatchGate.allowed) {
    return { outcome: "skipped", reason: dispatchGate.reason };
  }

  const intentId = readString(intentRow.id, "");
  if (!intentId) return { outcome: "skipped", reason: "missing_intent_id" };

  const claimed = await claimNeedsMoreDispatchIntent(supabase, intentId, now);
  if (!claimed) return { outcome: "skipped", reason: "claim_lost" };

  const revalidation = await revalidateNeedsMoreDispatchIntent(supabase, claimed, now);
  if (!revalidation.ok) {
    await cancelDispatchIntent(supabase, intentId, revalidation.reason, now);
    return { outcome: "canceled", reason: revalidation.reason };
  }

  const adapter = createPostmarkClientEmailAdapter(env, input.fetcher);
  const reminderIndexRaw = claimed.reminder_index;
  const payload = {
    intentId,
    fromEmail: readString(claimed.from_email_snapshot || claimed.from_email, ""),
    recipientEmail: readString(claimed.recipient_email, ""),
    subject: readString(claimed.snapshot_subject, ""),
    bodyText: readString(claimed.snapshot_body_text, ""),
    bodyHtml: readString(claimed.snapshot_body_html, ""),
    messageStream: CLIENT_EMAIL_POSTMARK_STREAM,
    category: "needs_more_target_accounts" as const,
    accountId: readString(claimed.account_id, ""),
    trigger: readString(claimed.trigger, "automatic_initial") as "automatic_initial",
    reminderIndex: typeof reminderIndexRaw === "number" ? reminderIndexRaw : null,
  };

  let sendResult;
  try {
    sendResult = await adapter.send(payload);
  } catch {
    await finalizeDispatchIntentUncertain(supabase, intentId, "provider_timeout", now);
    return { outcome: "dispatch_uncertain", intentId, reason: "provider_timeout" };
  }

  const attemptCount = readNumber(claimed.dispatch_attempt_count, 1);
  if (!sendResult.ok) {
    if (sendResult.reason === "sending_disabled" || sendResult.reason === "provider_not_configured") {
      await cancelDispatchIntent(supabase, intentId, sendResult.reason, now);
      return { outcome: "canceled", reason: sendResult.reason };
    }
    const releaseForRetry = sendResult.reason !== "invalid_from_email"
      && sendResult.reason !== "invalid_recipient_email";
    await finalizeDispatchIntentFailed(
      supabase,
      intentId,
      sendResult.reason,
      now,
      { attemptCount, releaseForRetry },
    );
    return { outcome: "failed", intentId, reason: sendResult.reason };
  }

  await finalizeDispatchIntentSent(supabase, intentId, sendResult.providerMessageId, now);
  return {
    outcome: "submitted",
    intentId,
    providerMessageId: sendResult.providerMessageId,
  };
}

export async function runNeedsMoreDispatchBatch(
  supabase: ClientEmailSupabase,
  input: {
    env?: Record<string, string | undefined>;
    now?: Date;
    fetcher?: typeof fetch;
  } = {},
) {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const dispatchGate = evaluateNeedsMoreDispatchAutomationGate(env);
  if (!dispatchGate.allowed) {
    return {
      dispatchGateOpen: false,
      gateReason: dispatchGate.reason,
      candidates: 0,
      submitted: 0,
      canceled: 0,
      failed: 0,
      uncertain: 0,
      skipped: 0,
      results: [] as DispatchIntentResult[],
    };
  }

  const candidates = await listNeedsMoreDispatchCandidates(supabase, now);
  const results: DispatchIntentResult[] = [];
  for (const candidate of candidates) {
    results.push(await dispatchSingleNeedsMoreIntent(supabase, candidate, { env, now, fetcher: input.fetcher }));
  }

  return {
    dispatchGateOpen: true,
    gateReason: null,
    candidates: candidates.length,
    submitted: results.filter((item) => item.outcome === "submitted").length,
    canceled: results.filter((item) => item.outcome === "canceled").length,
    failed: results.filter((item) => item.outcome === "failed").length,
    uncertain: results.filter((item) => item.outcome === "dispatch_uncertain").length,
    skipped: results.filter((item) => item.outcome === "skipped").length,
    results,
  };
}
