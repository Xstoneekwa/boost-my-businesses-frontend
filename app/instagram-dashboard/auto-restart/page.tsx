import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import AutoRestartRulesEditor from "@/components/instagram-dashboard/AutoRestartRulesEditor";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import {
  getAutoRestartData,
  type AutoRestartCandidate,
  type AutoRestartDecision,
  type AutoRestartQuotaPreview,
} from "../auto-restart-data";

export const dynamic = "force-dynamic";

function formatInteger(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function quotaText(quota: AutoRestartQuotaPreview) {
  return `${formatInteger(quota.doneToday)} / ${formatInteger(quota.capDay)} · ${formatInteger(quota.remaining)} left`;
}

function quotaTone(quota: AutoRestartQuotaPreview) {
  if (!quota.enabled) return "muted";
  if (quota.remaining <= 0) return "blocked";
  if (quota.plannedNextRunQuota > 0) return "ready";
  return "watch";
}

export default async function InstagramAutoRestartPage() {
  const userContext = await requireInstagramDashboardAccess();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const data = await getAutoRestartData();
  const { status, rules } = data;
  const settingsBackendPending = data.sourceStatus.some(
    (row) => row.label === "Auto Restart settings" && row.status === "pending",
  );

  return (
    <main className="dashboard-page ig-auto-restart-page">
      <DashboardPageHeader
        eyebrow="Admin scheduler"
        title="Auto Restart"
        description="Persisted restart settings, quota resume preview, reliability snapshot, and safety gates. Scheduler enqueue remains disabled."
      />

      {data.errors.length > 0 ? (
        <section className="ig-ar-alert" role="alert">
          <strong>Auto Restart data partially unavailable</strong>
          <span>{data.errors.join(" · ")}</span>
        </section>
      ) : null}

      <section className="ig-ar-status-grid" aria-label="Auto Restart status">
        <StatusCard label="Auto Restart" value={status.enabled ? "On" : "Off"} detail={status.statusLabel} tone={status.enabled ? "ready" : "muted"} />
        <StatusCard label="Runtime mode" value={status.mode === "dry_run" ? "Dry-run planning" : status.mode} detail="No automatic enqueue from BotApp." tone="watch" />
        <StatusCard label="Restart delay" value={`${rules.restartDelayMinutes} min`} detail="Used for next-restart preview and worker resume plan." tone="muted" />
        <StatusCard label="Next preview check" value={formatDateTime(status.nextSchedulerCheck)} detail="Preview-only cadence; scheduler heartbeat not wired." tone="muted" />
        <StatusCard label="Eligible candidates" value={formatInteger(status.activeRestartCandidates)} detail="Preview eligible only; no request is created." tone={status.activeRestartCandidates ? "ready" : "muted"} />
        <StatusCard label="Blocked candidates" value={formatInteger(status.blockedCandidates)} detail="Blocked by quotas, account gates, active requests, or missing sources." tone={status.blockedCandidates ? "watch" : "ready"} />
      </section>

      <section className="ig-ar-two-col">
        <AnalyticsSectionCard
          eyebrow="Rules"
          title="Restart Rules"
          description="Persisted in auto_restart_settings. Save updates Supabase; scheduler enqueue remains disabled."
        >
          <AutoRestartRulesEditor initialRules={rules} backendPending={settingsBackendPending} />
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          eyebrow="Restrictions"
          title="Thresholds / No-Overrun Rules"
          description="A restart can only plan the remaining daily quota for each enabled service."
        >
          <div className="ig-ar-thresholds">
            <Threshold label="Follow remaining" value={rules.thresholds.followRemainingMin} />
            <Threshold label="Unfollow remaining" value={rules.thresholds.unfollowRemainingMin} />
            <Threshold label="Welcome DM remaining" value={rules.thresholds.welcomeRemainingMin} />
            <Threshold label="Outreach DM remaining" value={rules.thresholds.outreachRemainingMin} />
          </div>
          <ul className="ig-ar-rule-list">
            <li>Do not restart if daily quota is exhausted.</li>
            <li>Do not restart if a run or request is already active.</li>
            <li>Do not restart on credential, checkpoint, 2FA, assignment, or device blockers.</li>
            <li>Planned next run quota is always `min(session cap, remaining day quota)`.</li>
            <li>Max attempts per session: {formatInteger(rules.maxAttemptsPerSession)}.</li>
          </ul>
        </AnalyticsSectionCard>
      </section>

      <AnalyticsSectionCard
        eyebrow="Quota Resume Preview"
        title="Candidate Accounts"
        description="Read-only preview with reliability snapshot. It does not enqueue account_run_requests."
      >
        <div className="ig-ar-table-wrap">
          <table className="ig-ar-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Package / Services</th>
                <th>Follow</th>
                <th>Unfollow</th>
                <th>Welcome</th>
                <th>Outreach</th>
                <th>Next run</th>
                <th>Gate</th>
                <th>Reliability</th>
              </tr>
            </thead>
            <tbody>
              {data.candidates.length ? data.candidates.map((candidate) => (
                <CandidateRow key={candidate.accountId} candidate={candidate} />
              )) : (
                <tr>
                  <td colSpan={9} className="ig-ar-empty">No active accounts available for preview.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AnalyticsSectionCard>

      <section className="ig-ar-two-col">
        <AnalyticsSectionCard
          eyebrow="Safety"
          title="Runtime Gates"
          description="Sources that must pass before active mode is allowed."
        >
          <div className="ig-ar-gates">
            {data.safetyGates.map((gate) => (
              <Gate key={gate.label} label={gate.label} status={gate.status} detail={gate.detail} />
            ))}
          </div>
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          eyebrow="Audit"
          title="Last Decisions"
          description="Dedicated Auto Restart decisions are not wired yet; this reads restart runtime events if present."
        >
          {data.decisions.length ? (
            <div className="ig-ar-decisions">
              {data.decisions.map((decision) => (
                <Decision key={decision.id} decision={decision} />
              ))}
            </div>
          ) : (
            <p className="ig-ar-empty">No Auto Restart decision events found. Future active mode should write `auto_restart_decisions` or runtime events with planned quotas and request IDs.</p>
          )}
        </AnalyticsSectionCard>
      </section>

      <AnalyticsSectionCard
        eyebrow="Sources"
        title="Readiness / Backend Contract"
        description="Frontend = Supabase settings = worker resume plan. Scheduler enqueue remains disabled."
      >
        <div className="ig-ar-source-grid">
          {data.sourceStatus.map((source) => (
            <Gate key={source.label} label={source.label} status={source.status} detail={source.detail} />
          ))}
        </div>
      </AnalyticsSectionCard>

      <style>{`
        .ig-auto-restart-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 22px 22px 48px;
        }

        .ig-ar-alert {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 18px;
          padding: 12px 14px;
          border: 1px solid rgba(248, 113, 113, 0.28);
          border-radius: 8px;
          background: rgba(248, 113, 113, 0.08);
          color: #8a8f98;
          font-size: 13px;
        }

        .ig-ar-alert strong {
          color: #fca5a5;
        }

        .ig-ar-status-grid,
        .ig-ar-source-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 12px;
          margin-bottom: 18px;
        }

        .ig-ar-two-col {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 18px;
        }

        .ig-ar-card,
        .ig-ar-gate,
        .ig-ar-decision {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: #1e2028;
          padding: 14px;
        }

        .ig-ar-card span,
        .ig-ar-gate span,
        .ig-ar-decision span,
        .ig-ar-field span,
        .ig-ar-threshold span {
          display: block;
          color: #8a8f98;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-ar-card strong,
        .ig-ar-gate strong,
        .ig-ar-decision strong {
          display: block;
          margin-top: 7px;
          color: #F8FAFC;
          font-size: 18px;
        }

        .ig-ar-card small,
        .ig-ar-gate small,
        .ig-ar-decision small,
        .ig-ar-field small {
          display: block;
          margin-top: 7px;
          color: rgba(255,255,255,0.54);
          line-height: 1.45;
        }

        .ig-ar-card-ready strong,
        .ig-ar-quota-ready strong {
          color: #86efac;
        }

        .ig-ar-card-watch strong,
        .ig-ar-quota-watch strong {
          color: #8a8f98;
        }

        .ig-ar-card-blocked strong,
        .ig-ar-quota-blocked strong {
          color: #fca5a5;
        }

        .ig-ar-card-muted strong,
        .ig-ar-quota-muted strong {
          color: #8a8f98;
        }

        .ig-ar-rule-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 12px;
        }

        .ig-ar-field {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          padding: 12px;
          background: rgba(15,23,42,0.35);
        }

        .ig-ar-field input {
          width: 100%;
          margin-top: 8px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: #1e2028;
          color: #e2e8f0;
          padding: 10px;
        }

        .ig-ar-switch {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          width: 100%;
          text-align: left;
          cursor: pointer;
        }

        .ig-ar-editor-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          margin-top: 14px;
        }

        .ig-ar-save-btn {
          border: 1px solid rgba(34,197,94,0.35);
          background: rgba(34,197,94,0.18);
          color: #86efac;
          border-radius: 8px;
          padding: 10px 14px;
          font-weight: 800;
          cursor: pointer;
        }

        .ig-ar-save-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .ig-ar-editor-meta {
          color: #8a8f98;
          font-size: 12px;
        }

        .ig-ar-switch-dot {
          width: 34px;
          height: 20px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.07);
          background: rgba(255,255,255,.07);
          position: relative;
          flex: 0 0 auto;
        }

        .ig-ar-switch-dot::after {
          content: "";
          position: absolute;
          width: 14px;
          height: 14px;
          top: 2px;
          left: 2px;
          border-radius: 999px;
          background: rgba(255,255,255,0.68);
        }

        .ig-ar-switch-on .ig-ar-switch-dot {
          border-color: rgba(34,197,94,0.35);
          background: rgba(34,197,94,0.22);
        }

        .ig-ar-switch-on .ig-ar-switch-dot::after {
          left: 16px;
          background: #86efac;
        }

        .ig-ar-pending-note,
        .ig-ar-empty,
        .ig-ar-rule-list {
          color: #8a8f98;
          font-size: 13px;
          line-height: 1.7;
        }

        .ig-ar-thresholds {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 12px;
          margin-bottom: 10px;
        }

        .ig-ar-threshold {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          padding: 12px;
          background: #1e2028;
        }

        .ig-ar-threshold strong {
          display: block;
          margin-top: 7px;
          color: #F8FAFC;
        }

        .ig-ar-table-wrap {
          overflow-x: auto;
        }

        .ig-ar-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1100px;
        }

        .ig-ar-table th,
        .ig-ar-table td {
          padding: 12px;
          border-bottom: 1px solid rgba(255,255,255,.07);
          vertical-align: top;
          text-align: left;
        }

        .ig-ar-table th {
          color: rgba(255,255,255,0.50);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-ar-account strong,
        .ig-ar-decision-cell strong {
          display: block;
          color: #F8FAFC;
        }

        .ig-ar-account small,
        .ig-ar-decision-cell small {
          display: block;
          margin-top: 5px;
          color: rgba(255,255,255,0.54);
        }

        .ig-ar-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .ig-ar-tag {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 999px;
          padding: 4px 8px;
          color: rgba(255,255,255,0.68);
          font-size: 11px;
          font-weight: 800;
        }

        .ig-ar-quota strong {
          display: block;
          font-size: 13px;
        }

        .ig-ar-quota small {
          display: block;
          margin-top: 4px;
          color: #8a8f98;
          font-size: 11px;
        }

        .ig-ar-gates,
        .ig-ar-decisions {
          display: grid;
          gap: 10px;
        }

        @media (max-width: 980px) {
          .ig-ar-two-col {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

function StatusCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "ready" | "watch" | "blocked" | "muted" }) {
  return (
    <article className={`ig-ar-card ig-ar-card-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Threshold({ label, value }: { label: string; value: number }) {
  return (
    <article className="ig-ar-threshold">
      <span>{label}</span>
      <strong>{formatInteger(value)}+</strong>
    </article>
  );
}

function CandidateRow({ candidate }: { candidate: AutoRestartCandidate }) {
  return (
    <tr>
      <td className="ig-ar-account">
        <strong>{candidate.username}</strong>
        <small>{candidate.phoneName} · {candidate.assignmentStatus}</small>
        <small>{candidate.phoneRestStatus} · {candidate.sessionWindowStatus}</small>
      </td>
      <td>
        <div className="ig-ar-tags">
          <span className="ig-ar-tag">{candidate.packageLabel}</span>
          <span className="ig-ar-tag">Add-ons: {candidate.commercialAddonsLabel}</span>
          <span className="ig-ar-tag">Outreach: {candidate.outreachSourceLabel}</span>
          <span className="ig-ar-tag">Runtime: {candidate.runtimeProfilesLabel}</span>
          <span className="ig-ar-tag">{candidate.followFiltersLabel}</span>
          {candidate.enabledServices.map((service) => <span key={service} className="ig-ar-tag">{service}</span>)}
        </div>
      </td>
      <QuotaCell quota={candidate.quotas.follow} />
      <QuotaCell quota={candidate.quotas.unfollow} />
      <QuotaCell quota={candidate.quotas.welcome} />
      <QuotaCell quota={candidate.quotas.outreach} />
      <td className="ig-ar-decision-cell">
        <strong>{candidate.plannedRunType}</strong>
        <small>Quota max: {formatInteger(
          candidate.plannedRunType === "outreach_session"
            ? candidate.quotas.outreach.plannedNextRunQuota
            : candidate.quotas.follow.plannedNextRunQuota + candidate.quotas.unfollow.plannedNextRunQuota + candidate.quotas.welcome.plannedNextRunQuota,
        )}</small>
      </td>
      <td className="ig-ar-decision-cell">
        <strong>{candidate.restartEligible ? "Eligible (preview)" : "Blocked"}</strong>
        <small>{candidate.blockReason}</small>
      </td>
      <td className="ig-ar-decision-cell">
        <strong>{candidate.reliability.restartAllowed === null ? "Unknown" : candidate.reliability.restartAllowed ? "Allowed" : "Blocked"}</strong>
        <small>Termination: {candidate.reliability.sessionTerminationClass || "—"}</small>
        <small>Attempt {candidate.reliability.currentAttempt} → {candidate.reliability.nextAttempt}</small>
        <small>Next restart: {formatDateTime(candidate.reliability.nextRestartAt)}</small>
        {candidate.reliability.unsafeMarkers.length ? (
          <small>Unsafe: {candidate.reliability.unsafeMarkers.join(", ")}</small>
        ) : null}
        {candidate.reliability.lastRestartError ? (
          <small>Error: {candidate.reliability.lastRestartError}</small>
        ) : null}
        <small>{candidate.reliability.sourceLabel}</small>
      </td>
    </tr>
  );
}

function QuotaCell({ quota }: { quota: AutoRestartQuotaPreview }) {
  return (
    <td className={`ig-ar-quota ig-ar-quota-${quotaTone(quota)}`}>
      <strong>{quotaText(quota)}</strong>
      <small>Next: {formatInteger(quota.plannedNextRunQuota)}</small>
    </td>
  );
}

function Gate({ label, status, detail }: { label: string; status: string; detail: string }) {
  return (
    <article className="ig-ar-gate">
      <span>{label}</span>
      <strong>{status}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Decision({ decision }: { decision: AutoRestartDecision }) {
  return (
    <article className="ig-ar-decision">
      <span>{formatDateTime(decision.decisionTime)} · {decision.mode}</span>
      <strong>{decision.action}</strong>
      <small>{decision.account} · {decision.reason}</small>
      <small>{decision.plannedQuotas}</small>
    </article>
  );
}
