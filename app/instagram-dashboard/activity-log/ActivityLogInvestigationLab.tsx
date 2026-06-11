"use client";

import { useMemo, useState } from "react";
import type {
  ActivityInvestigationMode,
  ActivityInvestigationPeriod,
  ActivityLogItem,
  ActivityLogOverview,
} from "../activity-log-data";
import { buildNoInteractionMessage, itemMatchesInvestigationQuery, normalizeActivitySearchTerm } from "../activity-log-data";

type ActivityLogInvestigationLabProps = {
  data: ActivityLogOverview;
};

const modes: Array<{ id: ActivityInvestigationMode; label: string; hint: string }> = [
  { id: "search_by_ct", label: "Search by CT", hint: "Find interactions sourced from one CT account." },
  { id: "search_by_account", label: "Search by Account", hint: "Check whether the tool interacted with one username." },
  { id: "recent_interactions", label: "Recent interactions", hint: "Review the newest interaction evidence." },
  { id: "disputes_evidence", label: "Disputes / Evidence", hint: "Prepare a safe evidence summary for review." },
];

const periodOptions: ActivityInvestigationPeriod[] = ["24h", "7d", "30d"];

function labelize(value: string | null | undefined) {
  return (value || "unknown").replace(/_/g, " ");
}

function username(value: string | null | undefined) {
  const cleaned = (value || "").trim().replace(/^@+/, "");
  return cleaned ? `@${cleaned}` : "unknown";
}

function toneFor(item: ActivityLogItem) {
  const status = item.actionStatus ?? item.result;
  if (status === "failed" || status === "rejected") return "danger";
  if (item.evidenceConfidence === "medium" || item.evidenceConfidence === "best_effort" || item.evidenceConfidence === "unknown") return "warning";
  return "good";
}

function evidenceSummary(item: ActivityLogItem) {
  const action = item.actionType ? labelize(item.actionType) : item.action;
  const client = username(item.clientAccountUsername ?? item.username);
  const interacted = username(item.interactedUsername ?? item.targetLabel);
  const ct = username(item.ctUsername);
  return item.safeSummary || `Interaction found: ${client} ${action} ${interacted} via CT ${ct}.`;
}

function safeExportRows(items: ActivityLogItem[]) {
  return items.map((item) => ({
    id: item.sourceRecordId ?? item.id,
    client_account: item.clientAccountUsername ?? item.username,
    ct_username: item.ctUsername,
    interacted_username: item.interactedUsername ?? item.targetLabel,
    action_type: item.actionType ?? item.action,
    status: item.actionStatus ?? item.result,
    occurred_at: item.occurredAt ?? item.timestamp,
    run_id: item.runId,
    request_id: item.requestId,
    safe_device_label: item.safeDeviceLabel,
    evidence_confidence: item.evidenceConfidence ?? item.reason,
    evidence_summary: evidenceSummary(item),
  }));
}

export default function ActivityLogInvestigationLab({ data }: ActivityLogInvestigationLabProps) {
  const [mode, setMode] = useState<ActivityInvestigationMode>("recent_interactions");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<ActivityInvestigationPeriod>("7d");
  const [actionType, setActionType] = useState("all");
  const [clientAccount, setClientAccount] = useState("all");
  const [status, setStatus] = useState("all");
  const [message, setMessage] = useState("");

  const actionTypes = useMemo(() => {
    const values = new Set(data.items.map((item) => item.actionType ?? item.action).filter(Boolean));
    return ["all", ...Array.from(values).sort()];
  }, [data.items]);

  const clientAccounts = useMemo(() => {
    const values = new Set(data.items.map((item) => normalizeActivitySearchTerm(item.clientAccountUsername ?? item.username ?? "")).filter(Boolean));
    return ["all", ...Array.from(values).sort()];
  }, [data.items]);

  const statuses = useMemo(() => {
    const values = new Set(data.items.map((item) => item.actionStatus ?? item.result).filter(Boolean));
    return ["all", ...Array.from(values).sort()];
  }, [data.items]);

  const query = { mode, search, period, actionType, clientAccount, status };
  const results = data.items.filter((item) => itemMatchesInvestigationQuery(item, query));
  const selectedTerm = normalizeActivitySearchTerm(search);
  const found = results.length > 0;
  const evidenceSourceActive = data.items.some((item) => item.isEvidenceProjection);
  const sourceLabel = evidenceSourceActive ? "Interaction evidence source active" : "CT lifecycle source active";

  function clearFilters() {
    setSearch("");
    setPeriod("7d");
    setActionType("all");
    setClientAccount("all");
    setStatus("all");
    setMessage("Filters cleared.");
  }

  async function copySummary(item: ActivityLogItem) {
    await navigator.clipboard.writeText(evidenceSummary(item));
    setMessage(`Evidence summary copied for ${username(item.interactedUsername ?? item.targetLabel)}.`);
  }

  function exportEvidence(format: "json" | "csv", item?: ActivityLogItem) {
    const rows = safeExportRows(item ? [item] : results);
    const content = format === "json"
      ? JSON.stringify(rows, null, 2)
      : [
        Object.keys(rows[0] ?? {}).join(","),
        ...rows.map((row) => Object.values(row).map((value) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`).join(",")),
      ].join("\n");
    const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `activity-log-evidence-safe.${format}`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`Safe ${format.toUpperCase()} export prepared for ${rows.length} record${rows.length === 1 ? "" : "s"}.`);
  }

  function prepareCtArchive(item: ActivityLogItem) {
    setMessage(`Archive/remove CT prepared for ${username(item.ctUsername)} from Activity Log investigation. Review the Targets contract before applying.`);
  }

  return (
    <section className="ig-investigation-lab" aria-label="Activity Log interaction investigation">
      <div className="ig-investigation-search">
        <div className="ig-investigation-search-main">
          <label>
            <span>Global search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={mode === "search_by_ct" ? "@ct_username" : mode === "search_by_account" ? "@interacted_account" : "@username or CT"}
            />
          </label>
          <button type="button" onClick={() => setMessage(found ? `Interaction found for ${selectedTerm ? `@${selectedTerm}` : "the selected filters"}.` : buildNoInteractionMessage(search))}>
            Search
          </button>
          <button type="button" onClick={clearFilters}>Clear filters</button>
          <button type="button" onClick={() => exportEvidence("json")} disabled={!results.length}>Export JSON</button>
        </div>

        <div className="ig-investigation-modes" aria-label="Activity investigation modes">
          {modes.map((item) => (
            <button key={item.id} type="button" className={mode === item.id ? "active" : ""} onClick={() => setMode(item.id)} title={item.hint}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ig-investigation-kpis" aria-label="Investigation summary">
        <Kpi label="Evidence records" value={data.summary.totalItems} detail={sourceLabel} />
        <Kpi label="Found now" value={results.length} detail={`${labelize(mode)} in ${period}`} tone={results.length ? "good" : "warning"} />
        <Kpi label="CT sources" value={new Set(data.items.map((item) => item.ctUsername ?? item.ctId).filter(Boolean)).size} detail="Safe source usernames or IDs" tone="info" />
        <Kpi label="Needs review" value={data.items.filter((item) => toneFor(item) !== "good").length} detail="Medium, unknown, failed or rejected evidence" tone="warning" />
      </div>

      <div className="ig-investigation-card">
        <div className="ig-investigation-card-heading">
          <span>{labelize(mode)}</span>
          <h2>{found ? "Interaction found" : "No interaction found"}</h2>
          <p>{found ? `${results.length} result${results.length === 1 ? "" : "s"} for ${selectedTerm ? `@${selectedTerm}` : "the selected filters"} in ${period}.` : buildNoInteractionMessage(search)}</p>
        </div>

        <div className="ig-investigation-filters" aria-label="Interaction filters">
          <Select label="Period" value={period} onChange={(value) => setPeriod(value as ActivityInvestigationPeriod)} options={periodOptions} />
          <Select label="Action type" value={actionType} onChange={setActionType} options={actionTypes} />
          <Select label="Client account" value={clientAccount} onChange={setClientAccount} options={clientAccounts} />
          <Select label="Status" value={status} onChange={setStatus} options={statuses} />
        </div>

        {!found ? (
          <div className="ig-investigation-empty">
            <span>No interaction found</span>
            <strong>{buildNoInteractionMessage(search)}</strong>
            <p>Period: {period}. Action type: {labelize(actionType)}. Status: {labelize(status)}.</p>
          </div>
        ) : null}

        <div className="ig-investigation-results">
          {results.map((item) => (
            <article key={`${item.id}-${item.sourceRecordId ?? ""}`} className={`ig-investigation-result ${toneFor(item)}`}>
              <div className="ig-investigation-result-main">
                <div>
                  <span>{labelize(item.actionType ?? item.action)}</span>
                  <h3>{username(item.interactedUsername ?? item.targetLabel)}</h3>
                  <p>{evidenceSummary(item)}</p>
                </div>
                <div className="ig-investigation-badges">
                  <Badge label={item.actionStatus ?? item.result} tone={toneFor(item)} />
                  <Badge label={item.evidenceConfidence ?? item.reason ?? "unknown"} tone={toneFor(item)} />
                </div>
              </div>

              <div className="ig-investigation-meta">
                <Field label="Client account" value={username(item.clientAccountUsername ?? item.username)} />
                <Field label="CT source" value={username(item.ctUsername)} />
                <Field label="Occurred" value={item.occurredAt ?? item.timestamp ?? "unknown"} />
                <Field label="Run / session" value={item.runId ?? item.requestId ?? "unknown"} />
                <Field label="Device" value={item.safeDeviceLabel ?? "unknown"} />
                <Field label="Evidence" value={item.evidenceSourceTable ?? item.sourceLabel} />
              </div>

              <div className="ig-investigation-evidence">
                <span>Evidence summary</span>
                <strong>{evidenceSummary(item)}</strong>
              </div>

              <div className="ig-investigation-actions">
                {item.accountId ? <a href={`/instagram-dashboard/accounts/${encodeURIComponent(item.accountId)}`}>Open account</a> : <button type="button" disabled>Open account</button>}
                {item.ctId ? <a href={`/instagram-dashboard/targets?targetId=${encodeURIComponent(item.ctId)}&source=activity_log_investigation`}>Open CT</a> : <button type="button" disabled>Open CT</button>}
                <button type="button" onClick={() => prepareCtArchive(item)} disabled={!item.ctId && !item.ctUsername}>Archive/remove CT</button>
                <button type="button" onClick={() => void copySummary(item)}>Copy summary</button>
                <button type="button" onClick={() => exportEvidence("json", item)}>Export JSON</button>
                <button type="button" onClick={() => exportEvidence("csv", item)}>Export CSV</button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="ig-investigation-boundary">
        <span>Server Check boundary</span>
        <p>Runtime events, worker process logs, heartbeats, incidents, delivery diagnostics and server health stay outside Activity Log.</p>
      </div>

      {message ? <div className="ig-investigation-message" role="status">{message}</div> : null}
    </section>
  );
}

function Kpi({ label, value, detail, tone = "neutral" }: { label: string; value: number; detail: string; tone?: "neutral" | "good" | "warning" | "info" }) {
  return (
    <article className={`ig-investigation-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="ig-investigation-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option === "all" ? "All" : labelize(option)}</option>)}
      </select>
    </label>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return <strong className={`ig-investigation-badge ${tone}`}>{labelize(label)}</strong>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="ig-investigation-field">
      <span>{label}</span>
      <strong>{value || "unknown"}</strong>
    </span>
  );
}
