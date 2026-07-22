import { resolveAccountFollowBusinessPolicy, type FollowOverrideSource } from "./follow-business-policy";
import { buildAccountFollowLimitProjection } from "./follow-limit-projection";
import { createSupabaseClient } from "../supabase";

type SupabaseRecord = Record<string, unknown>;
type SupabaseClientLike = ReturnType<typeof createSupabaseClient>;

function record(value: unknown): SupabaseRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SupabaseRecord : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function overrideSource(value: unknown): FollowOverrideSource | null {
  return value === "admin" || value === "support" || value === "migration_confirmed" ? value : null;
}

async function selectOne(
  supabase: SupabaseClientLike,
  table: string,
  columns: string,
  accountId: string,
) {
  const result = await supabase.from(table).select(columns).eq("account_id", accountId).limit(1).maybeSingle<SupabaseRecord>();
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return result.data;
}

export async function loadAccountFollowLimitProjection(
  supabase: SupabaseClientLike,
  accountId: string,
  asOf: string | Date = new Date(),
) {
  const [summary, overrideRow, warmup, legacy] = await Promise.all([
    selectOne(supabase, "account_package_summary", "account_id,commercial_package_code,package_caps", accountId),
    selectOne(
      supabase,
      "ig_account_follow_limit_overrides",
      "account_id,follow_day_cap_override,follow_session_cap_override,source,source_surface,updated_by,reason,created_at,updated_at",
      accountId,
    ),
    selectOne(
      supabase,
      "account_warmup_settings",
      "account_id,warmup_enabled,package_started_at,day_1_follow_cap,day_2_follow_cap,day_3_follow_cap,day_4_plus_follow_cap,status",
      accountId,
    ),
    selectOne(supabase, "ig_account_settings", "account_id,max_actions_per_day,follow_limit,max_follow_per_run", accountId),
  ]);
  const packageCaps = record(summary?.package_caps);
  const source = overrideSource(overrideRow?.source);
  if (overrideRow && source === null) throw new Error("ig_account_follow_limit_overrides: invalid source");

  const policy = resolveAccountFollowBusinessPolicy({
    packageCode: text(summary?.commercial_package_code),
    packageDayCap: number(packageCaps?.follow_day),
    packageSessionCap: number(packageCaps?.follow_session),
    override: overrideRow && source ? {
      followDayCapOverride: number(overrideRow.follow_day_cap_override),
      followSessionCapOverride: number(overrideRow.follow_session_cap_override),
      source,
    } : null,
    warmup: {
      enabled: boolean(warmup?.warmup_enabled, true),
      packageStartedAt: text(warmup?.package_started_at),
      day1FollowCap: number(warmup?.day_1_follow_cap),
      day2FollowCap: number(warmup?.day_2_follow_cap),
      day3FollowCap: number(warmup?.day_3_follow_cap),
      day4PlusFollowCap: number(warmup?.day_4_plus_follow_cap),
    },
    asOf,
  });

  return buildAccountFollowLimitProjection(policy, {
    maxActionsPerDay: number(legacy?.max_actions_per_day),
    followLimit: number(legacy?.follow_limit),
    maxFollowPerRun: number(legacy?.max_follow_per_run),
  });
}
