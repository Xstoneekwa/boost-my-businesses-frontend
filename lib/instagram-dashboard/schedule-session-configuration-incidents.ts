type RpcResult = { data?: unknown; error?: { message?: string } | null };

type SupabaseLike = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  from: (table: string) => unknown;
};

type SingleQuery = {
  select: (columns: string) => SingleQuery;
  eq: (column: string, value: string) => SingleQuery;
  maybeSingle: () => Promise<RpcResult>;
};

function singleQuery(supabase: SupabaseLike, table: string) {
  return supabase.from(table) as SingleQuery;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export const WELCOME_TEMPLATE_MISSING_REASON = "welcome_template_missing";
export const WELCOME_TEMPLATE_MISSING_INCIDENT_TYPE = "account_configuration_failure";

export async function reportWelcomeTemplateMissingIncident(
  supabase: SupabaseLike,
  input: { accountId: string; assignmentId: string; startsAt: string; endsAt: string },
) {
  try {
    const [{ data: accountData }, { data: packageData }] = await Promise.all([
      singleQuery(supabase, "ig_accounts").select("id,username,client_id").eq("id", input.accountId).maybeSingle(),
      singleQuery(supabase, "account_package_summary").select("commercial_package_label").eq("account_id", input.accountId).maybeSingle(),
    ]);
    const account = record(accountData);
    const packageSummary = record(packageData);
    const username = text(account.username, "Instagram account").slice(0, 120);
    const packageLabel = text(packageSummary.commercial_package_label, "Unknown").slice(0, 80);
    const dedupeKey = `account:${input.accountId}:account_configuration_failure:${WELCOME_TEMPLATE_MISSING_REASON}`;
    const incidentResult = await supabase.rpc("upsert_account_incident", {
      p_incident_type: WELCOME_TEMPLATE_MISSING_INCIDENT_TYPE,
      p_dedupe_key: dedupeKey,
      p_severity: "warning",
      p_status: "open",
      p_client_id: text(account.client_id) || null,
      p_account_id: input.accountId,
      p_account_username: username,
      p_run_id: null,
      p_assignment_id: input.assignmentId,
      p_device_id: null,
      p_clone_id: null,
      p_source_event_id: null,
      p_source: "schedule_session_cron",
      p_reason: WELCOME_TEMPLATE_MISSING_REASON,
      p_failure_reason: WELCOME_TEMPLATE_MISSING_REASON,
      p_action_required: "Add a valid active Welcome DM template or disable Welcome DM.",
      p_safe_client_message: "Account run blocked: Welcome DM is enabled but no active message template exists.",
      p_assistant_message: "Review Welcome DM configuration before the next scheduled window.",
      p_admin_message: `Account run blocked for ${username}: Welcome DM is enabled but no active message template exists.`,
      p_metadata: {
        source: "schedule_session_cron",
        stable_reason: WELCOME_TEMPLATE_MISSING_REASON,
        stage: "configuration",
        package: packageLabel,
        assignment_id: input.assignmentId,
        window_starts_at: input.startsAt,
        window_ends_at: input.endsAt,
        blocking_campaign: true,
        operator_review_required: true,
      },
    });
    if (incidentResult.error) return { ok: false as const, reason: incidentResult.error.message || "incident_upsert_failed" };
    const incident = record(incidentResult.data);
    const incidentId = text(incident.id);
    const actionResult = await supabase.rpc("upsert_account_dashboard_action", {
      p_account_id: input.accountId,
      p_client_id: text(account.client_id) || null,
      p_incident_id: incidentId || null,
      p_action_type: "scheduler_launch_blocked",
      p_status: "pending",
      p_title: "Welcome template missing",
      p_dedupe_key: `${dedupeKey}:dashboard_action`,
      p_safe_client_message: "Add a valid Welcome DM template or disable Welcome DM before the campaign can run.",
      p_admin_message: `Blocked — Welcome template missing for ${username}.`,
      p_assistant_message: null,
      p_action_label: "Open DM Templates",
      p_action_deep_link: "/instagram-dashboard/dm-templates",
      p_severity: "warning",
      p_audience: "admin",
      p_requires_client_action: false,
      p_blocking_campaign: true,
      p_metadata: { stable_reason: WELCOME_TEMPLATE_MISSING_REASON, incident_id: incidentId || null },
    });
    if (actionResult.error) return { ok: false as const, reason: actionResult.error.message || "action_upsert_failed" };
    return { ok: true as const, incidentId };
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message : "incident_reporting_failed" };
  }
}

export async function resolveWelcomeTemplateMissingIncidents(supabase: SupabaseLike, accountId: string) {
  try {
    const result = await supabase.rpc("resolve_welcome_template_missing_incidents_v1", {
      p_account_id: accountId,
    });
    if (result.error) return { ok: false as const, reason: result.error.message || "incident_resolution_failed" };
    return { ok: true as const, resolvedCount: Number(result.data) || 0 };
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message : "incident_resolution_failed" };
  }
}
