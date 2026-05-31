import { getDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { sanitizeRunControlReason } from "@/lib/instagram-dashboard/run-control";
import { createSupabaseClient } from "@/lib/supabase";
import {
  getAccountId,
  jsonError,
  jsonOk,
  readBoolean,
  readJsonBody,
  readString,
  requireInstagramAdmin,
  validateAccountId,
  type SupabaseRecord,
} from "../../_utils";

export const dynamic = "force-dynamic";

export type FollowFiltersDomainPatchPayload = {
  account_id?: unknown;
  skip_private_profiles?: unknown;
};

export type FollowFiltersProjection = {
  account_id: string;
  skip_private_profiles: boolean;
  runtime_status: "active";
  save_ready: boolean;
  changed_fields?: string[];
};

const DEFAULT_SKIP_PRIVATE_PROFILES = true;

function projectionFromRow(accountId: string, row: SupabaseRecord | null | undefined): FollowFiltersProjection {
  const dontFollowPrivate =
    row && typeof row.dont_follow_private_accounts === "boolean"
      ? row.dont_follow_private_accounts
      : DEFAULT_SKIP_PRIVATE_PROFILES;
  return {
    account_id: accountId,
    skip_private_profiles: dontFollowPrivate,
    runtime_status: "active",
    save_ready: true,
  };
}

function redactedSummary(skipPrivateProfiles: boolean) {
  return {
    skip_private_profiles: skipPrivateProfiles,
    dont_follow_private_accounts: skipPrivateProfiles,
  };
}

async function fetchFollowSettingsRow(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const { data, error } = await supabase
    .from("ig_account_follow_settings")
    .select("account_id,dont_follow_private_accounts")
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

    const supabase = createSupabaseClient();
    const beforeRow = await fetchFollowSettingsRow(supabase, accountId);
    const before = projectionFromRow(accountId, beforeRow);
    const skipPrivateProfiles =
      body.skip_private_profiles !== undefined
        ? readBoolean(body.skip_private_profiles, before.skip_private_profiles)
        : before.skip_private_profiles;

    const fieldsChanged =
      before.skip_private_profiles !== skipPrivateProfiles ? ["skip_private_profiles"] : [];

    if (!fieldsChanged.length) {
      return jsonOk({ ...before, changed_fields: [] });
    }

    const { error } = await supabase.from("ig_account_follow_settings").upsert(
      {
        account_id: accountId,
        dont_follow_private_accounts: skipPrivateProfiles,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" },
    );
    if (error) {
      return jsonError(sanitizeRunControlReason(error.message, "Could not save Follow filter settings."), 500);
    }

    const actorContext = await getDashboardUserContext();
    await recordAudit(supabase, {
      accountId,
      actorId: actorContext?.userId ?? null,
      fieldsChanged,
      oldSummary: redactedSummary(before.skip_private_profiles),
      newSummary: redactedSummary(skipPrivateProfiles),
    }).catch(() => undefined);

    const after = projectionFromRow(accountId, {
      account_id: accountId,
      dont_follow_private_accounts: skipPrivateProfiles,
    });
    return jsonOk({ ...after, changed_fields: fieldsChanged });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save Follow filter settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not save Follow filter settings."), 500);
  }
}
