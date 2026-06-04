import { sanitizeRunControlReason } from "@/lib/instagram-dashboard/run-control";
import { createSupabaseClient } from "@/lib/supabase";
import {
  getAccountId,
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readBoolean,
  readJsonBody,
  readInteger,
  readString,
  requireInstagramAdmin,
  validateAccountId,
  type SupabaseRecord,
} from "../../_utils";

export const dynamic = "force-dynamic";

export type FollowFiltersDomainPatchPayload = {
  account_id?: unknown;
  skip_private_profiles?: unknown;
  min_followers?: unknown;
  max_followers?: unknown;
  min_posts?: unknown;
};

export type FollowFiltersProjection = {
  account_id: string;
  skip_private_profiles: boolean;
  min_followers: number | null;
  max_followers: number | null;
  min_posts: number | null;
  runtime_ready_fields: string[];
  planned_fields: string[];
  runtime_status: "active";
  save_ready: boolean;
  changed_fields?: string[];
};

const DEFAULT_SKIP_PRIVATE_PROFILES = true;
const RUNTIME_READY_FIELDS = ["skip_private_profiles", "min_followers", "max_followers", "min_posts"] as const;
const PLANNED_FIELDS = [
  "require_profile_photo",
  "skip_verified",
  "skip_verified_profiles",
  "skip_business",
  "skip_business_accounts",
  "skip_creator",
  "skip_creator_accounts",
  "blacklist_enabled",
  "whitelist_enabled",
  "exclusion_policies",
  "outreach_filters",
  "ct_quality",
] as const;
const ALLOWED_PATCH_FIELDS = new Set<string>(["account_id", ...RUNTIME_READY_FIELDS]);
const PLANNED_PATCH_FIELDS = new Set<string>(PLANNED_FIELDS);

function readNullableNonnegativeInteger(value: unknown, fieldName: string): { value: number | null; error: string } {
  if (value === null || value === undefined) return { value: null, error: "" };
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { value: null, error: `${fieldName}_invalid` };
  }
  if (value < 0) return { value: null, error: `${fieldName}_negative` };
  return { value: readInteger(value, 0), error: "" };
}

function rowIntegerOrNull(row: SupabaseRecord | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function projectionFromRow(accountId: string, row: SupabaseRecord | null | undefined): FollowFiltersProjection {
  const dontFollowPrivate =
    row && typeof row.dont_follow_private_accounts === "boolean"
      ? row.dont_follow_private_accounts
      : DEFAULT_SKIP_PRIVATE_PROFILES;
  return {
    account_id: accountId,
    skip_private_profiles: dontFollowPrivate,
    min_followers: rowIntegerOrNull(row, "min_followers"),
    max_followers: rowIntegerOrNull(row, "max_followers"),
    min_posts: rowIntegerOrNull(row, "min_posts"),
    runtime_ready_fields: [...RUNTIME_READY_FIELDS],
    planned_fields: [...PLANNED_FIELDS],
    runtime_status: "active",
    save_ready: true,
  };
}

function redactedSummary(settings: Pick<FollowFiltersProjection, "skip_private_profiles" | "min_followers" | "max_followers" | "min_posts">) {
  return {
    skip_private_profiles: settings.skip_private_profiles,
    dont_follow_private_accounts: settings.skip_private_profiles,
    min_followers: settings.min_followers,
    max_followers: settings.max_followers,
    min_posts: settings.min_posts,
  };
}

async function fetchFollowSettingsRow(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const { data, error } = await supabase
    .from("ig_account_follow_settings")
    .select("account_id,dont_follow_private_accounts,min_followers,max_followers,min_posts")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function recordAudit(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    accountId: string;
    actorId: string | null;
    fieldsChanged: string[];
    oldSummary: Record<string, unknown>;
    newSummary: Record<string, unknown>;
  },
) {
  await supabase.from("ig_action_logs").insert({
    account_id: input.accountId,
    run_id: null,
    target_username: null,
    action_type: "follow_filters_domain_settings_saved",
    status: "success",
    message: "Follow filter settings saved from admin dashboard.",
    payload: {
      actor_type: "admin",
      actor_id: input.actorId,
      source_surface: "instagram_dashboard",
      domain: "follow_filters",
      fields_changed: input.fieldsChanged,
      old_summary: input.oldSummary,
      new_summary: input.newSummary,
    },
    created_at: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const row = await fetchFollowSettingsRow(supabase, accountId);
    return jsonOk(projectionFromRow(accountId, row));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Follow filter settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not load Follow filter settings."), 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<FollowFiltersDomainPatchPayload>(request);
    if (!body) return jsonError("Invalid Follow filter settings payload.", 400);

    const accountId = readString(body.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    if (body.skip_private_profiles !== undefined && typeof body.skip_private_profiles !== "boolean") {
      return jsonError("skip_private_profiles must be a boolean.", 400);
    }
    for (const key of Object.keys(body)) {
      if (PLANNED_PATCH_FIELDS.has(key)) {
        return jsonError("filter_not_runtime_ready", 400);
      }
      if (!ALLOWED_PATCH_FIELDS.has(key)) {
        return jsonError("Invalid Follow filter settings payload.", 400);
      }
    }

    const supabase = createSupabaseClient();
    const beforeRow = await fetchFollowSettingsRow(supabase, accountId);
    const before = projectionFromRow(accountId, beforeRow);
    const skipPrivateProfiles =
      body.skip_private_profiles !== undefined
        ? readBoolean(body.skip_private_profiles, before.skip_private_profiles)
        : before.skip_private_profiles;
    const minFollowers = body.min_followers !== undefined
      ? readNullableNonnegativeInteger(body.min_followers, "min_followers")
      : { value: before.min_followers, error: "" };
    const maxFollowers = body.max_followers !== undefined
      ? readNullableNonnegativeInteger(body.max_followers, "max_followers")
      : { value: before.max_followers, error: "" };
    const minPosts = body.min_posts !== undefined
      ? readNullableNonnegativeInteger(body.min_posts, "min_posts")
      : { value: before.min_posts, error: "" };

    const validationError = minFollowers.error || maxFollowers.error || minPosts.error;
    if (validationError) return jsonError(validationError, 400);
    if (minFollowers.value !== null && maxFollowers.value !== null && minFollowers.value > maxFollowers.value) {
      return jsonError("follow_filter_invalid_range", 400);
    }

    const fieldsChanged = [
      before.skip_private_profiles !== skipPrivateProfiles ? "skip_private_profiles" : "",
      before.min_followers !== minFollowers.value ? "min_followers" : "",
      before.max_followers !== maxFollowers.value ? "max_followers" : "",
      before.min_posts !== minPosts.value ? "min_posts" : "",
    ].filter(Boolean);

    if (!fieldsChanged.length) {
      return jsonOk({ ...before, changed_fields: [] });
    }

    const { error } = await supabase.from("ig_account_follow_settings").upsert(
      {
        account_id: accountId,
        dont_follow_private_accounts: skipPrivateProfiles,
        min_followers: minFollowers.value,
        max_followers: maxFollowers.value,
        min_posts: minPosts.value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" },
    );
    if (error) {
      return jsonError(sanitizeRunControlReason(error.message, "Could not save Follow filter settings."), 500);
    }

    const actorContext = await getInstagramAdminUserContext();
    await recordAudit(supabase, {
      accountId,
      actorId: actorContext?.userId ?? null,
      fieldsChanged,
      oldSummary: redactedSummary(before),
      newSummary: redactedSummary({
        skip_private_profiles: skipPrivateProfiles,
        min_followers: minFollowers.value,
        max_followers: maxFollowers.value,
        min_posts: minPosts.value,
      }),
    }).catch(() => undefined);

    const after = projectionFromRow(accountId, {
      account_id: accountId,
      dont_follow_private_accounts: skipPrivateProfiles,
      min_followers: minFollowers.value,
      max_followers: maxFollowers.value,
      min_posts: minPosts.value,
    });
    return jsonOk({ ...after, changed_fields: fieldsChanged });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save Follow filter settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not save Follow filter settings."), 500);
  }
}
