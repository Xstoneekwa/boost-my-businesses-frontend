import { sanitizeRunControlReason } from "@/lib/instagram-dashboard/run-control";
import {
  FOLLOW_SOURCE_ROTATION_BOUNDS,
  followSourceRotationDefaultsForPackage,
  followSourceRotationChangedFields,
  followSourceRotationPersistenceMismatch,
  redactedFollowSourceRotationSummary,
  validateFollowSourceRotationInteger,
  type FollowSourceRotationField,
} from "@/lib/instagram-dashboard/follow-source-settings";
import { createSupabaseClient } from "@/lib/supabase";
import {
  getAccountId,
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireRelayOrAdmin,
  validateAccountId,
  type SupabaseRecord,
} from "../../_utils";

export const dynamic = "force-dynamic";

type SettingsSource = "account_setting" | "env_fallback" | "default";

export type FollowSourcesProjection = {
  account_id: string;
  max_follows_per_target_per_run: number;
  max_targets_per_run: number;
  source: SettingsSource;
  bounds: {
    max_follows_per_target_per_run: { min: number; max: number };
    max_targets_per_run: { min: number; max: number };
  };
  save_ready: boolean;
  runtime_status: "active" | "schema_pending";
  note: string;
  changed_fields?: string[];
};

export type FollowSourcesPatchPayload = {
  account_id?: unknown;
  max_follows_per_target_per_run?: unknown;
  max_targets_per_run?: unknown;
};

const ALLOWED_PATCH_FIELDS = new Set([
  "account_id",
  "max_follows_per_target_per_run",
  "max_targets_per_run",
]);

type PackageRotationContext = {
  packageLabel: string;
  bounds: FollowSourcesProjection["bounds"];
};

function isFollowSourcesSchemaPending(message: string) {
  return /account_follow_source_settings|schema cache|could not find/i.test(message);
}

function readEnvInteger(
  envName: string,
  fieldName: FollowSourceRotationField,
): number | null {
  const raw = process.env[envName]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  const result = validateFollowSourceRotationInteger(parsed, fieldName);
  return result.error ? null : result.value;
}

function fallbackPackageRotationContext(packageLabel?: string | null): PackageRotationContext {
  const defaults = followSourceRotationDefaultsForPackage(packageLabel);
  return {
    packageLabel: packageLabel ?? "",
    bounds: {
      max_follows_per_target_per_run: {
        min: FOLLOW_SOURCE_ROTATION_BOUNDS.max_follows_per_target_per_run.min,
        max: defaults.max_follows_per_target_per_run,
      },
      max_targets_per_run: {
        min: FOLLOW_SOURCE_ROTATION_BOUNDS.max_targets_per_run.min,
        max: defaults.max_targets_per_run,
      },
    },
  };
}

function envFallbackProjection(accountId: string, packageContext: PackageRotationContext): FollowSourcesProjection {
  const envMaxFollows = readEnvInteger(
    "FOLLOW_TARGET_MAX_FOLLOWS_PER_TARGET_PER_RUN",
    "max_follows_per_target_per_run",
  );
  const envMaxTargets = readEnvInteger(
    "FOLLOW_TARGET_ROTATION_MAX_TARGETS_PER_RUN",
    "max_targets_per_run",
  );
  const hasEnvFallback = envMaxFollows !== null || envMaxTargets !== null;
  const packageDefaults = followSourceRotationDefaultsForPackage(packageContext.packageLabel);
  return {
    account_id: accountId,
    max_follows_per_target_per_run:
      envMaxFollows ?? packageDefaults.max_follows_per_target_per_run,
    max_targets_per_run: envMaxTargets ?? packageDefaults.max_targets_per_run,
    source: hasEnvFallback ? "env_fallback" : "default",
    bounds: packageContext.bounds,
    save_ready: true,
    runtime_status: "active",
    note: "Per-run settings. Global Follow caps still apply.",
  };
}

function projectionFromRow(
  accountId: string,
  row: SupabaseRecord | null | undefined,
  packageContext: PackageRotationContext,
): FollowSourcesProjection {
  if (!row) return envFallbackProjection(accountId, packageContext);
  const packageDefaults = followSourceRotationDefaultsForPackage(packageContext.packageLabel);
  return {
    account_id: accountId,
    max_follows_per_target_per_run:
      typeof row.max_follows_per_target_per_run === "number"
        ? row.max_follows_per_target_per_run
        : packageDefaults.max_follows_per_target_per_run,
    max_targets_per_run:
      typeof row.max_targets_per_run === "number"
        ? row.max_targets_per_run
        : packageDefaults.max_targets_per_run,
    source: "account_setting",
    bounds: packageContext.bounds,
    save_ready: true,
    runtime_status: "active",
    note: "Per-run settings. Global Follow caps still apply.",
  };
}

function pendingProjection(accountId: string, packageContext: PackageRotationContext): FollowSourcesProjection {
  return {
    ...envFallbackProjection(accountId, packageContext),
    save_ready: false,
    runtime_status: "schema_pending",
    note: "Follow source settings schema is pending.",
  };
}

function boundedPackageMaximum(value: unknown, field: FollowSourceRotationField, fallback: number) {
  const globalBounds = FOLLOW_SOURCE_ROTATION_BOUNDS[field];
  return typeof value === "number" && Number.isInteger(value) && value >= globalBounds.min && value <= globalBounds.max
    ? value
    : fallback;
}

async function fetchCommercialPackageRotation(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
): Promise<PackageRotationContext> {
  const { data, error } = await supabase
    .from("account_package_summary")
    .select("commercial_package_code,commercial_package_label")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  const packageLabel = readString(data?.commercial_package_label, "");
  const fallback = fallbackPackageRotationContext(packageLabel);
  const packageCode = readString(data?.commercial_package_code, "");
  if (error || !packageCode) return fallback;

  const { data: runtime, error: runtimeError } = await supabase
    .from("commercial_package_runtime_settings")
    .select("max_follows_per_target_per_run,max_targets_per_run")
    .eq("package_code", packageCode)
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  if (runtimeError || !runtime) return fallback;

  return {
    packageLabel,
    bounds: {
      max_follows_per_target_per_run: {
        min: FOLLOW_SOURCE_ROTATION_BOUNDS.max_follows_per_target_per_run.min,
        max: boundedPackageMaximum(
          runtime.max_follows_per_target_per_run,
          "max_follows_per_target_per_run",
          fallback.bounds.max_follows_per_target_per_run.max,
        ),
      },
      max_targets_per_run: {
        min: FOLLOW_SOURCE_ROTATION_BOUNDS.max_targets_per_run.min,
        max: boundedPackageMaximum(
          runtime.max_targets_per_run,
          "max_targets_per_run",
          fallback.bounds.max_targets_per_run.max,
        ),
      },
    },
  };
}

async function fetchFollowSourceSettingsRow(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const { data, error } = await supabase
    .from("account_follow_source_settings")
    .select("account_id,max_follows_per_target_per_run,max_targets_per_run,updated_at,updated_by,metadata")
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
    action_type: "follow_source_rotation_settings_saved",
    status: "success",
    message: "Follow source rotation settings saved from admin dashboard.",
    payload: {
      actor_type: "admin",
      actor_id: input.actorId,
      source_surface: "instagram_dashboard",
      domain: "follow_sources",
      fields_changed: input.fieldsChanged,
      old_summary: input.oldSummary,
      new_summary: input.newSummary,
    },
    created_at: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Follow sources settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const packageContext = await fetchCommercialPackageRotation(supabase, accountId);
    try {
      const row = await fetchFollowSourceSettingsRow(supabase, accountId);
      return jsonOk(projectionFromRow(accountId, row, packageContext));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (isFollowSourcesSchemaPending(message)) return jsonOk(pendingProjection(accountId, packageContext));
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Follow source settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not load Follow source settings."), 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Follow sources settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<FollowSourcesPatchPayload>(request);
    if (!body) return jsonError("Invalid Follow source settings payload.", 400);

    const accountId = readString(body.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    for (const key of Object.keys(body)) {
      if (!ALLOWED_PATCH_FIELDS.has(key)) {
        return jsonError("Invalid Follow source settings payload.", 400);
      }
    }

    const maxFollows = validateFollowSourceRotationInteger(
      body.max_follows_per_target_per_run,
      "max_follows_per_target_per_run",
    );
    if (maxFollows.error) return jsonError(maxFollows.error, 400);
    const maxTargets = validateFollowSourceRotationInteger(body.max_targets_per_run, "max_targets_per_run");
    if (maxTargets.error) return jsonError(maxTargets.error, 400);

    const supabase = createSupabaseClient();
    const packageContext = await fetchCommercialPackageRotation(supabase, accountId);
    if (maxFollows.value > packageContext.bounds.max_follows_per_target_per_run.max) {
      return jsonError("max_follows_per_target_per_run_exceeds_package_ceiling", 400);
    }
    if (maxTargets.value > packageContext.bounds.max_targets_per_run.max) {
      return jsonError("max_targets_per_run_exceeds_package_ceiling", 400);
    }
    let before: FollowSourcesProjection;
    try {
      before = projectionFromRow(accountId, await fetchFollowSourceSettingsRow(supabase, accountId), packageContext);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (isFollowSourcesSchemaPending(message)) {
        return jsonError("Follow source settings are unavailable until the account_follow_source_settings migration is applied.", 409);
      }
      throw error;
    }

    const fieldsChanged = followSourceRotationChangedFields(before, {
      max_follows_per_target_per_run: maxFollows.value,
      max_targets_per_run: maxTargets.value,
    });
    if (!fieldsChanged.length) {
      return jsonOk({ ...before, changed_fields: [] });
    }

    const actorContext = await getInstagramAdminUserContext();
    const actorId = actorContext?.userId ?? null;
    const now = new Date().toISOString();
    const { error } = await supabase.from("account_follow_source_settings").upsert(
      {
        account_id: accountId,
        max_follows_per_target_per_run: maxFollows.value,
        max_targets_per_run: maxTargets.value,
        updated_at: now,
        updated_by: actorId,
        metadata: {
          source_surface: "instagram_dashboard",
          settings_scope: "per_account",
        },
      },
      { onConflict: "account_id" },
    );
    if (error) {
      return jsonError(sanitizeRunControlReason(error.message, "Could not save Follow source settings."), 500);
    }

    let after: FollowSourcesProjection;
    try {
      after = projectionFromRow(
        accountId,
        await fetchFollowSourceSettingsRow(supabase, accountId),
        packageContext,
      );
    } catch (readAfterWriteError) {
      const message = readAfterWriteError instanceof Error ? readAfterWriteError.message : "";
      return jsonError(
        sanitizeRunControlReason(message, "Could not verify saved Follow source settings."),
        500,
      );
    }

    const persistenceMismatch = followSourceRotationPersistenceMismatch(
      {
        max_follows_per_target_per_run: maxFollows.value,
        max_targets_per_run: maxTargets.value,
      },
      after,
    );
    if (persistenceMismatch.length) {
      return jsonError(
        `Follow source settings were not persisted: ${persistenceMismatch.join(",")}.`,
        409,
      );
    }
    await recordAudit(supabase, {
      accountId,
      actorId,
      fieldsChanged,
      oldSummary: redactedFollowSourceRotationSummary(before),
      newSummary: redactedFollowSourceRotationSummary(after),
    }).catch(() => undefined);

    return jsonOk({ ...after, changed_fields: fieldsChanged });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save Follow source settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not save Follow source settings."), 500);
  }
}
