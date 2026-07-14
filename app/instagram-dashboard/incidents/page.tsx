import Link from "next/link";
import { notFound } from "next/navigation";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";
import {
  buildIncidentCounters,
  buildIncidentList,
  mapIncidentRow,
  type IncidentViewModel,
} from "@/lib/instagram-dashboard/incident-operations";
import {
  evaluateReadyToResume,
  type RecoveryView,
} from "@/lib/instagram-dashboard/incident-resume-authorization";
import { ReadyToResumeButton } from "./ReadyToResumeButton";
import { MarkReviewedButton } from "./MarkReviewedButton";
import {
  findLinkedOperatorAction,
  linkedOperatorReviewState,
} from "@/lib/instagram-dashboard/incident-operator-review";

export const dynamic = "force-dynamic";

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function stateLabel(state: IncidentViewModel["displayState"]) {
  if (state === "action_required") return "Action required";
  if (state === "reviewed") return "Reviewed";
  if (state === "resolved") return "Resolved";
  if (state === "acknowledged") return "Acknowledged";
  if (state === "ignored") return "Ignored";
  // P3 recovery states. "Ready to resume" is reserved for the BUTTON on an
  // eligible, not-yet-armed incident; the armed state reads unambiguously.
  if (state === "ready_to_resume") return "Resume authorized — awaiting next tick";
  if (state === "resume_requested") return "Resume requested";
  if (state === "reintervention_required") return "New intervention required";
  return "Open";
}

/** Stable, safe operator copy for recovery refusal reasons (CP1 codes). */
const RECOVERY_REASON_COPY: Record<string, string> = {
  awaiting_next_scheduler_tick: "Authorization armed — awaiting the next Auto Restart tick.",
  resume_window_closed: "Recovery window closed — no resume can be armed.",
  resume_authorization_expired: "Recovery window expired — the resume authorization expired.",
  resume_authorization_already_armed: "A resume authorization is already armed.",
  resume_retry_window_exhausted: "Resume budget already consumed for this window.",
  resume_plan_missing: "No resume plan for this run (pre-P3 run).",
  resume_plan_not_recoverable: "Incident not automatically recoverable — resolve manually.",
  incident_not_active: "Incident already resolved or ignored.",
};

function recoveryReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return RECOVERY_REASON_COPY[reason] ?? reason;
}

function authorizationLabel(status: string | null): string | null {
  if (!status) return null;
  if (status === "armed") return "Armed — awaiting next tick";
  if (status === "consumed") return "Authorization consumed";
  if (status === "expired") return "Recovery window expired";
  return status;
}

function formatWindow(start: string | null, end: string | null) {
  if (!start || !end) return null;
  return `${formatDateTime(start)} → ${formatDateTime(end)}`;
}

function deliveryLabel(state: IncidentViewModel["deliveryState"]) {
  if (state === "delivered") return "Slack/Discord delivered";
  if (state === "delivery_degraded") return "Delivery degraded";
  if (state === "pending") return "Delivery pending";
  return "Not notified";
}

const INCIDENT_SELECT =
  "id,status,severity,incident_type,reason,failure_reason,action_required,admin_message,account_id,account_username,run_id,occurrence_count,first_seen_at,last_seen_at,resolved_at,source,metadata";

interface FocusedIncident {
  model: IncidentViewModel;
  recovery: RecoveryView;
}

interface ReviewableOperatorAction {
  id: string;
  accountId: string;
}

function readIncidentIdFromAction(row: Record<string, unknown>) {
  const direct = String(row.incident_id ?? "").trim();
  if (direct) return direct;
  for (const value of [row.metadata, row.metadata_safe]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const incidentId = String((value as Record<string, unknown>).incident_id ?? "").trim();
    if (incidentId) return incidentId;
  }
  return "";
}

/**
 * P3.1 deep-link: load ONE incident explicitly by id (Slack/Discord link),
 * even when it is metadata.test=true, with its server-evaluated recovery view.
 */
async function loadFocusedIncident(
  supabase: ReturnType<typeof createSupabaseClient>,
  incidentId: string,
): Promise<FocusedIncident | null> {
  const { data: incidentRow, error } = await supabase
    .from("account_incidents")
    .select(INCIDENT_SELECT)
    .eq("id", incidentId)
    .maybeSingle();
  if (error || !incidentRow) return null;
  const { data: outboxRows } = await supabase
    .from("account_incident_notifications")
    .select("incident_id,channel,status,attempt_count,delivered_at,last_error")
    .eq("incident_id", incidentId);
  const { data: actionRows } = await supabase
    .from("account_dashboard_actions")
    .select("id,account_id,incident_id,action_type,status,blocking_campaign,dedupe_key,metadata,metadata_safe,created_at")
    .eq("account_id", String(incidentRow.account_id ?? ""))
    .eq("action_type", "operator_review_required")
    .order("created_at", { ascending: false })
    .limit(100);
  const baseModel = mapIncidentRow(incidentRow, outboxRows ?? []);
  const linkedAction = findLinkedOperatorAction(actionRows ?? [], {
    id: incidentId,
    accountId: baseModel.accountId ?? "",
    runId: baseModel.runId,
    requestId: baseModel.runRequestId,
  });
  const model = mapIncidentRow(
    incidentRow,
    outboxRows ?? [],
    linkedOperatorReviewState(linkedAction),
  );
  let recovery: RecoveryView;
  try {
    recovery = await evaluateReadyToResume(supabase, incidentRow as Record<string, unknown>);
  } catch {
    recovery = {
      state: "none",
      eligible: false,
      reason: "recovery_state_unavailable",
      windowStart: null,
      windowEnd: null,
      windowActive: false,
      resumePlanId: null,
      authorizationId: null,
      authorizationStatus: null,
    };
  }
  return { model, recovery };
}

async function loadIncidents(includeTest: boolean, focusedIncidentId: string) {
  const supabase = createSupabaseClient();
  const { data: incidentRows, error } = await supabase
    .from("account_incidents")
    .select(INCIDENT_SELECT)
    .order("last_seen_at", { ascending: false })
    .limit(100);
  if (error) {
    return {
      models: [] as IncidentViewModel[],
      counters: buildIncidentCounters([]),
      windows: new Map<string, { start: string | null; end: string | null }>(),
      focused: null as FocusedIncident | null,
      reviewActions: new Map<string, ReviewableOperatorAction>(),
      error: error.message,
    };
  }
  const incidentIds = (incidentRows ?? []).map((row) => String(row.id ?? "")).filter(Boolean);
  let notificationRows: Record<string, unknown>[] = [];
  if (incidentIds.length) {
    const { data: outboxRows } = await supabase
      .from("account_incident_notifications")
      .select("incident_id,channel,status,attempt_count,delivered_at,last_error")
      .in("incident_id", incidentIds);
    notificationRows = outboxRows ?? [];
  }
  let operatorActionRows: Record<string, unknown>[] = [];
  if (incidentIds.length) {
    const { data: actionRows } = await supabase
      .from("account_dashboard_actions")
      .select("id,account_id,incident_id,action_type,status,blocking_campaign,dedupe_key,metadata,metadata_safe,created_at")
      .eq("action_type", "operator_review_required")
      .in("incident_id", incidentIds)
      .order("created_at", { ascending: false })
      .limit(1000);
    operatorActionRows = actionRows ?? [];
  }
  let models = buildIncidentList(incidentRows ?? [], notificationRows, operatorActionRows, { includeTest });
  const counters = buildIncidentCounters(
    buildIncidentList(incidentRows ?? [], notificationRows, operatorActionRows, { includeTest: true }),
  );

  // Deep-link target: loaded explicitly, shown even when test incidents are
  // hidden by the default filter, and force-included in the list.
  const focused = focusedIncidentId
    ? await loadFocusedIncident(supabase, focusedIncidentId)
    : null;
  if (focused && !models.some((m) => m.id === focused.model.id)) {
    models = [focused.model, ...models];
  }

  const reviewActions = new Map<string, ReviewableOperatorAction>();
  for (const row of operatorActionRows) {
    const status = String(row.status ?? "").trim().toLowerCase();
    if (!["pending", "acknowledged", "pending_verification", "code_submitted"].includes(status)) continue;
    const incidentId = readIncidentIdFromAction(row as Record<string, unknown>);
    const id = String(row.id ?? "").trim();
    const accountId = String(row.account_id ?? "").trim();
    if (incidentId && id && accountId) reviewActions.set(incidentId, { id, accountId });
  }

  // P3: resume windows per incident run (read-only recovery context).
  const runIds = models.map((m) => m.runId).filter((id): id is string => Boolean(id));
  const windows = new Map<string, { start: string | null; end: string | null }>();
  if (runIds.length) {
    const { data: planRows } = await supabase
      .from("account_session_resume_plans")
      .select("run_id,scheduled_window_start,scheduled_window_end")
      .in("run_id", runIds);
    for (const row of planRows ?? []) {
      const runId = String(row.run_id ?? "");
      if (!runId) continue;
      windows.set(runId, {
        start: (row.scheduled_window_start as string | null) ?? null,
        end: (row.scheduled_window_end as string | null) ?? null,
      });
    }
  }
  return { models, counters, windows, focused, reviewActions, error: null as string | null };
}

export default async function InstagramIncidentsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userContext = await requireInstagramDashboardAccess();
  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const params = (await searchParams) ?? {};
  const includeTest = params.include_test === "1";
  const focusedIncidentId =
    typeof params.incident_id === "string" ? params.incident_id.trim() : "";
  const { models, counters, windows, focused, reviewActions, error } = await loadIncidents(
    includeTest,
    focusedIncidentId,
  );

  return (
    <main className="dashboard-page ig-incidents-page">
      <DashboardPageHeader
        eyebrow="Operations"
        title="Incidents"
        description="Canonical runtime incidents with true failure reasons. Internal only."
      />

      <section className="ig-inc-counters">
        <div className="ig-inc-counter ig-inc-counter-action">
          <span>Action required</span>
          <strong>{counters.actionRequired}</strong>
        </div>
        <div className="ig-inc-counter">
          <span>Open</span>
          <strong>{counters.open}</strong>
        </div>
        <div className="ig-inc-counter">
          <span>Resolved</span>
          <strong>{counters.resolved}</strong>
        </div>
        <div className="ig-inc-counter ig-inc-counter-degraded">
          <span>Delivery degraded</span>
          <strong>{counters.deliveryDegraded}</strong>
        </div>
      </section>

      {error ? (
        <section className="ig-inc-alert" role="alert">
          <strong>Incidents unavailable</strong>
          <span>{error}</span>
        </section>
      ) : null}

      {focusedIncidentId && !focused && !error ? (
        <section className="ig-inc-alert" role="alert">
          <strong>Incident not found</strong>
          <span>No incident with id {focusedIncidentId}.</span>
        </section>
      ) : null}

      {focused ? (
        <section className="ig-inc-focused" data-testid="incident-focused-detail">
          <div className="ig-inc-row-head">
            <span className={`ig-inc-badge ig-inc-badge-${focused.model.displayState}`}>
              {stateLabel(focused.model.displayState)}
            </span>
            <span className={`ig-inc-severity ig-inc-severity-${focused.model.severity}`}>
              {focused.model.severity}
            </span>
            {focused.model.isTest ? <span className="ig-inc-test-badge">TEST</span> : null}
            <span className="ig-inc-time">{formatDateTime(focused.model.lastSeenAt)}</span>
          </div>
          <div className="ig-inc-row-main">
            <strong>{focused.model.operatorLabel}</strong>
            <code>{focused.model.reasonCode}</code>
          </div>
          {focused.model.adminMessage ? (
            <p className="ig-inc-focused-message">{focused.model.adminMessage}</p>
          ) : null}
          <div className="ig-inc-row-meta">
            <span>@{focused.model.accountUsername || focused.model.accountId || "internal"}</span>
            <span>{focused.model.incidentType}</span>
            {focused.model.runId ? (
              <span title={focused.model.runId}>run {focused.model.runId.slice(0, 8)}…</span>
            ) : null}
          </div>
          <div className="ig-inc-focused-recovery">
            <h3>Controlled recovery</h3>
            <dl>
              <div>
                <dt>Recovery state</dt>
                <dd>{stateLabel(focused.model.displayState)}</dd>
              </div>
              <div>
                <dt>Recovery window</dt>
                <dd>
                  {focused.recovery.windowStart || focused.recovery.windowEnd
                    ? `${formatWindow(focused.recovery.windowStart, focused.recovery.windowEnd)}${focused.recovery.windowActive ? " (active)" : " (closed)"}`
                    : "—"}
                </dd>
              </div>
              {focused.recovery.authorizationStatus ? (
                <div>
                  <dt>Authorization</dt>
                  <dd>{authorizationLabel(focused.recovery.authorizationStatus)}</dd>
                </div>
              ) : null}
            </dl>
            {focused.recovery.eligible ? (
              <ReadyToResumeButton incidentId={focused.model.id} />
            ) : (
              <p className="ig-inc-focused-reason">
                {recoveryReasonLabel(focused.recovery.reason)
                  ?? "No resume action available for this incident."}
              </p>
            )}
          </div>
          {reviewActions.has(focused.model.id) ? (
            <MarkReviewedButton
              actionId={reviewActions.get(focused.model.id)!.id}
              accountId={reviewActions.get(focused.model.id)!.accountId}
            />
          ) : null}
        </section>
      ) : null}

      {models.length === 0 && !error ? (
        <section className="ig-inc-empty">
          No incidents{includeTest ? "" : " (test incidents hidden)"}.
        </section>
      ) : null}

      <ul className="ig-inc-list">
        {models.map((incident) => (
          <li
            key={incident.id}
            id={`incident-${incident.id}`}
            className={`ig-inc-row ig-inc-state-${incident.displayState}${incident.id === focusedIncidentId ? " ig-inc-row-focused" : ""}`}
          >
            <div className="ig-inc-row-head">
              <span className={`ig-inc-badge ig-inc-badge-${incident.displayState}`}>
                {stateLabel(incident.displayState)}
              </span>
              <span className={`ig-inc-severity ig-inc-severity-${incident.severity}`}>
                {incident.severity}
              </span>
              {incident.isTest ? <span className="ig-inc-test-badge">TEST</span> : null}
              <span className="ig-inc-time">{formatDateTime(incident.lastSeenAt)}</span>
            </div>
            <div className="ig-inc-row-main">
              <strong>{incident.operatorLabel}</strong>
              <code>{incident.reasonCode}</code>
            </div>
            {incident.actionRequired ? (
              <p className="ig-inc-action">{incident.actionRequired}</p>
            ) : null}
            {incident.recoveryState ? (
              <p className="ig-inc-recovery">
                Recovery : {stateLabel(incident.displayState)}
                {incident.runId && formatWindow(
                  windows.get(incident.runId)?.start ?? null,
                  windows.get(incident.runId)?.end ?? null,
                ) ? (
                  <span> · window {formatWindow(
                    windows.get(incident.runId)?.start ?? null,
                    windows.get(incident.runId)?.end ?? null,
                  )}</span>
                ) : null}
              </p>
            ) : null}
            {reviewActions.has(incident.id) ? (
              <MarkReviewedButton
                actionId={reviewActions.get(incident.id)!.id}
                accountId={reviewActions.get(incident.id)!.accountId}
              />
            ) : null}
            <div className="ig-inc-row-meta">
              {incident.accountHref ? (
                <Link href={incident.accountHref}>
                  @{incident.accountUsername || incident.accountId}
                </Link>
              ) : (
                <span>@{incident.accountUsername || "internal"}</span>
              )}
              <span>{incident.incidentType}</span>
              <span>×{incident.occurrenceCount}</span>
              <span className={`ig-inc-delivery ig-inc-delivery-${incident.deliveryState}`}>
                {deliveryLabel(incident.deliveryState)}
              </span>
              {incident.runId ? <span title={incident.runId}>run {incident.runId.slice(0, 8)}…</span> : null}
            </div>
          </li>
        ))}
      </ul>

      <footer className="ig-inc-footer">
        {includeTest ? (
          <Link
            href={
              focusedIncidentId
                ? `/instagram-dashboard/incidents?incident_id=${encodeURIComponent(focusedIncidentId)}`
                : "/instagram-dashboard/incidents"
            }
          >
            Hide test incidents
          </Link>
        ) : (
          <Link
            href={
              focusedIncidentId
                ? `/instagram-dashboard/incidents?include_test=1&incident_id=${encodeURIComponent(focusedIncidentId)}`
                : "/instagram-dashboard/incidents?include_test=1"
            }
          >
            Show test incidents
          </Link>
        )}
      </footer>

      <style>{`
        .ig-incidents-page {
          width: min(100%, 960px);
          margin: 0 auto;
          padding: 22px 20px 48px;
          box-sizing: border-box;
        }
        .ig-inc-counters {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
          gap: 10px;
          margin-bottom: 18px;
        }
        .ig-inc-counter {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 10px;
          background: #1e2028;
          padding: 12px 14px;
        }
        .ig-inc-counter span {
          display: block;
          color: #8a8f98;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: .06em;
          text-transform: uppercase;
        }
        .ig-inc-counter strong {
          display: block;
          margin-top: 6px;
          color: #f8fafc;
          font-size: 20px;
        }
        .ig-inc-counter-action strong { color: #fca5a5; }
        .ig-inc-counter-degraded strong { color: #fdba74; }
        .ig-inc-alert {
          display: flex;
          gap: 10px;
          margin-bottom: 16px;
          padding: 12px 14px;
          border: 1px solid rgba(248,113,113,.28);
          border-radius: 8px;
          background: rgba(248,113,113,.08);
          color: #8a8f98;
          font-size: 13px;
        }
        .ig-inc-empty {
          padding: 22px;
          border: 1px dashed rgba(255,255,255,.12);
          border-radius: 10px;
          color: #8a8f98;
          text-align: center;
        }
        .ig-inc-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 10px;
        }
        .ig-inc-row {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 10px;
          background: #1e2028;
          padding: 12px 14px;
          display: grid;
          gap: 8px;
        }
        .ig-inc-state-action_required { border-color: rgba(248,113,113,.35); }
        .ig-inc-row-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .ig-inc-badge {
          padding: 3px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: .04em;
          text-transform: uppercase;
        }
        .ig-inc-badge-open { background: rgba(59,130,246,.16); color: #93c5fd; }
        .ig-inc-badge-action_required { background: rgba(248,113,113,.16); color: #fca5a5; }
        .ig-inc-badge-resolved { background: rgba(34,197,94,.16); color: #86efac; }
        .ig-inc-badge-acknowledged { background: rgba(250,204,21,.14); color: #fde68a; }
        .ig-inc-badge-ignored { background: rgba(148,163,184,.16); color: #cbd5e1; }
        .ig-inc-badge-ready_to_resume { background: rgba(45,212,191,.16); color: #5eead4; text-transform: none; }
        .ig-inc-badge-resume_requested { background: rgba(59,130,246,.18); color: #93c5fd; }
        .ig-inc-badge-reintervention_required { background: rgba(248,113,113,.2); color: #fca5a5; }
        .ig-inc-recovery {
          margin: 0;
          color: #5eead4;
          font-size: 12.5px;
        }
        .ig-inc-focused {
          margin-bottom: 18px;
          padding: 14px 16px;
          border: 1px solid rgba(45,212,191,.45);
          border-radius: 12px;
          background: rgba(45,212,191,.06);
          display: grid;
          gap: 8px;
        }
        .ig-inc-focused-message {
          margin: 0;
          color: #cbd5e1;
          font-size: 13px;
          line-height: 1.5;
        }
        .ig-inc-focused-recovery {
          border-top: 1px solid rgba(255,255,255,.08);
          padding-top: 10px;
        }
        .ig-inc-focused-recovery h3 {
          margin: 0 0 8px;
          color: #5eead4;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .05em;
          text-transform: uppercase;
        }
        .ig-inc-focused-recovery dl {
          margin: 0 0 10px;
          display: grid;
          gap: 6px;
        }
        .ig-inc-focused-recovery dt {
          color: #8a8f98;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .05em;
        }
        .ig-inc-focused-recovery dd {
          margin: 2px 0 0;
          color: #f8fafc;
          font-size: 13px;
        }
        .ig-inc-focused-reason {
          margin: 0;
          color: #fdba74;
          font-size: 13px;
        }
        .ig-inc-ready-wrap { display: inline-flex; align-items: center; gap: 10px; }
        .ig-inc-ready-btn {
          padding: 8px 16px;
          border: none;
          border-radius: 8px;
          background: #2dd4bf;
          color: #042f2e;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
        }
        .ig-inc-ready-btn:disabled { opacity: .6; cursor: wait; }
        .ig-inc-ready-refusal { color: #fca5a5; font-size: 12px; }
        .ig-inc-review-confirm {
          display: grid;
          gap: 10px;
          width: min(460px, 100%);
          padding: 12px;
          border: 1px solid rgba(45,212,191,.35);
          border-radius: 8px;
          background: rgba(15,23,42,.72);
        }
        .ig-inc-review-confirm-copy { color: #e2e8f0; font-size: 13px; }
        .ig-inc-review-note-label { display: grid; gap: 6px; color: #cbd5e1; font-size: 12px; }
        .ig-inc-review-note {
          width: 100%;
          resize: vertical;
          padding: 8px 10px;
          border: 1px solid #334155;
          border-radius: 6px;
          background: #0f172a;
          color: #f8fafc;
          font: inherit;
        }
        .ig-inc-review-actions { display: flex; align-items: center; gap: 8px; }
        .ig-inc-review-cancel {
          padding: 8px 12px;
          border: 1px solid #475569;
          border-radius: 8px;
          background: transparent;
          color: #e2e8f0;
          cursor: pointer;
        }
        .ig-inc-review-cancel:disabled { opacity: .6; cursor: wait; }
        .ig-inc-row-focused {
          border-color: rgba(45,212,191,.55);
          box-shadow: 0 0 0 1px rgba(45,212,191,.35);
        }
        .ig-inc-severity {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          color: #cbd5e1;
        }
        .ig-inc-severity-critical { color: #fca5a5; }
        .ig-inc-severity-error { color: #fdba74; }
        .ig-inc-test-badge {
          padding: 2px 8px;
          border-radius: 999px;
          background: rgba(168,85,247,.18);
          color: #d8b4fe;
          font-size: 10px;
          font-weight: 800;
        }
        .ig-inc-time {
          margin-left: auto;
          color: #8a8f98;
          font-size: 12px;
          white-space: nowrap;
        }
        .ig-inc-row-main {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 10px;
        }
        .ig-inc-row-main strong { color: #f8fafc; font-size: 14px; }
        .ig-inc-row-main code {
          color: #93c5fd;
          font-size: 12px;
          background: rgba(59,130,246,.08);
          padding: 2px 6px;
          border-radius: 6px;
          overflow-wrap: anywhere;
        }
        .ig-inc-action {
          margin: 0;
          color: #fca5a5;
          font-size: 13px;
          line-height: 1.45;
        }
        .ig-inc-row-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 14px;
          color: #8a8f98;
          font-size: 12px;
        }
        .ig-inc-row-meta a { color: #93c5fd; text-decoration: none; font-weight: 700; }
        .ig-inc-delivery-delivered { color: #86efac; }
        .ig-inc-delivery-delivery_degraded { color: #fdba74; font-weight: 700; }
        .ig-inc-delivery-pending { color: #fde68a; }
        .ig-inc-footer {
          margin-top: 16px;
          font-size: 13px;
        }
        .ig-inc-footer a { color: #93c5fd; text-decoration: none; }
      `}</style>
    </main>
  );
}
