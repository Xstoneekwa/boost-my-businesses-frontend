import { createSupabaseClient } from "@/lib/supabase";
import { readString } from "./guards";
import {
  clientActivityPeriodSince,
  filterClientActivityItems,
  mapClientInteractionEvent,
  mapClientTargetAuditEvent,
  paginateClientActivityItems,
  type ClientActivityPage,
  type ClientActivityQuery,
  type InternalActivityRow,
} from "./client-activity-log-projection";

export type {
  ClientActivityItem,
  ClientActivityLang,
  ClientActivityPage,
  ClientActivityQuery,
} from "./client-activity-log-projection";

export {
  clientActivityActionLabel,
  clientActivityDetailLabel,
  clientActivityResultLabel,
  clientActivityMuteDetailLabel,
  collectForbiddenAmbiguousClientLabels,
  collectForbiddenClientActivityTerms,
  decodeClientActivityCursor,
  encodeClientActivityCursor,
  filterClientActivityItems,
  mapClientInteractionEvent,
  mapClientTargetAuditEvent,
  normalizeClientActivitySearch,
  paginateClientActivityItems,
} from "./client-activity-log-projection";

type SafeRecord = Record<string, unknown>;

export async function loadClientAccountActivity(
  accountId: string,
  query: ClientActivityQuery = {},
): Promise<ClientActivityPage | null> {
  if (!accountId) return null;
  const lang = query.lang === "en" ? "en" : "fr";
  const since = clientActivityPeriodSince(query.period);
  const supabase = createSupabaseClient();

  const [accountResult, interactionResult, auditResult] = await Promise.all([
    supabase.from("ig_accounts").select("id,username").eq("id", accountId).maybeSingle(),
    supabase
      .from("ig_interaction_events")
      .select("id,event_type,event_status,event_reason,event_at,created_at,username,source_target_username,interaction_type,payload")
      .eq("account_id", accountId)
      .gte("event_at", since)
      .order("event_at", { ascending: false })
      .limit(2000),
    supabase
      .from("ct_target_audit_events")
      .select("id,created_at,operation,result,reason,target_id,metadata_safe")
      .eq("account_id", accountId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  if (accountResult.error || !accountResult.data?.id) return null;

  const accountUsername = readString(accountResult.data.username, "") || null;
  const auditRows = (auditResult.data ?? []) as SafeRecord[];
  const targetIds = [...new Set(auditRows.map((row) => readString(row.target_id, "")).filter(Boolean))];
  const targetLabels = new Map<string, string>();

  if (targetIds.length > 0) {
    const { data: targets } = await supabase
      .from("ig_targets")
      .select("id,target_username,normalized_username,input_username")
      .in("id", targetIds);
    for (const row of (targets ?? []) as SafeRecord[]) {
      const id = readString(row.id, "");
      const username = readString(row.target_username, "")
        || readString(row.normalized_username, "")
        || readString(row.input_username, "");
      if (id && username) targetLabels.set(id, username);
    }
  }

  const interactionItems = ((interactionResult.data ?? []) as SafeRecord[])
    .map((row) => mapClientInteractionEvent(row, accountUsername, lang))
    .filter((item): item is InternalActivityRow => Boolean(item));

  const auditItems = auditRows.map((row) => {
    const targetId = readString(row.target_id, "");
    const targetUsername = targetId ? targetLabels.get(targetId) ?? null : null;
    return mapClientTargetAuditEvent(row, accountUsername, targetUsername, lang);
  });

  const merged = [...interactionItems, ...auditItems];
  const filtered = filterClientActivityItems(merged, query);
  return paginateClientActivityItems(filtered, query);
}
