import { formatDateTime, formatInteger, statusTone } from "../manage-data";
import type { LivePhoneAppInstance, LivePhoneDevice, LivePhoneInventorySummary } from "../devices-live-data";

function Kpi({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "good" | "warning" }) {
  const color = tone === "good" ? "#34D399" : tone === "warning" ? "#FBBF24" : "#f0f0ef";

  return (
    <article className="ig-devices-kpi">
      <span>{label}</span>
      <strong style={{ color }}>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function DevicesKpis({ summary }: { summary: LivePhoneInventorySummary }) {
  return (
    <section className="ig-devices-kpis" aria-label="Device inventory summary">
      <Kpi label="Total phones" value={formatInteger(summary.total_phone_devices)} detail="phone_devices rows" />
      <Kpi label="Physical phones" value={formatInteger(summary.physical_phone_count)} detail="Physical devices registered" />
      <Kpi label="Emulators" value={formatInteger(summary.emulator_count)} detail="Emulator devices registered" />
      <Kpi label="App instances" value={formatInteger(summary.total_app_instances)} detail="phone_app_instances rows" />
      <Kpi label="Available instances" value={formatInteger(summary.available_app_instances)} detail="Ready app instance slots" tone="good" />
      <Kpi label="Occupied instances" value={formatInteger(summary.occupied_app_instances)} detail="Currently assigned slots" tone={summary.occupied_app_instances ? "warning" : "good"} />
      <Kpi label="Problem phones" value={formatInteger(summary.problem_phone_count)} detail="Phones with inventory issues" tone={summary.problem_phone_count ? "warning" : "good"} />
      <Kpi label="ADB status unknown" value={formatInteger(summary.adb_status_unknown_count)} detail="No heartbeat data available" tone={summary.adb_status_unknown_count ? "warning" : "good"} />
    </section>
  );
}

export function RegisteredPhonesList({ phones }: { phones: LivePhoneDevice[] }) {
  if (!phones.length) {
    return <div className="ig-devices-pending"><span>Empty state</span><strong>No registered phones</strong><p>devices_overview returned an empty phone_devices list.</p></div>;
  }

  return (
    <div className="ig-devices-accordion-list">
      {phones.map((phone) => (
        <details className="ig-devices-accordion ig-devices-phone-nested" key={phone.device_id || phone.adb_serial || phone.display_name}>
          <summary>
            <span className="ig-devices-chevron" aria-hidden="true">&gt;</span>
            <span className="ig-devices-summary-title">
              <strong>{phone.display_name || phone.adb_serial || "Unnamed phone"}</strong>
              <span>{phone.adb_serial || "missing adb_serial"}</span>
            </span>
            <Metric label="Kind" value={phone.device_kind || phone.kind || "unknown"} />
            <Metric label="Status" value={phone.status} tone={phone.status} />
            <Metric label="Pool" value={phone.pool} />
            <Metric label="Apps" value={`${formatInteger(phone.app_instances_available_count)} / ${formatInteger(phone.app_instances_occupied_count)} / ${formatInteger(phone.app_instances_count)}`} />
            <Metric label="Heartbeat" value={phone.heartbeat_status} tone={phone.heartbeat_status} />
            <Metric label="Issues" value={phone.issues.length ? formatInteger(phone.issues.length) : "0"} tone={phone.issues.length ? "monitor" : "ok"} />
          </summary>
          <div className="ig-devices-accordion-body">
            <div className="ig-devices-phone-detail-grid">
              <PhoneDetails phone={phone} />
              <IssueList issues={phone.issues} />
            </div>
            <AppInstancesList instances={phone.app_instances} />
          </div>
        </details>
      ))}
    </div>
  );
}

function PhoneDetails({ phone }: { phone: LivePhoneDevice }) {
  return (
    <div className="ig-devices-safe-detail">
      <span className="ig-devices-detail-label">Phone details</span>
      <strong>{phone.model || "Model unknown"}</strong>
      <p>Product: {phone.product || "unknown"} · Device: {phone.device || "unknown"}</p>
      <p>Max clones: {phone.max_clones === null ? "unknown" : formatInteger(phone.max_clones)}</p>
      <p>Hub: {[phone.hub_label, phone.hub_port].filter(Boolean).join(" / ") || "unknown"}</p>
      <p>Host: {phone.host_label || "unknown"}</p>
      <p>Heartbeat last seen: {formatDateTime(phone.heartbeat_last_seen_at)}</p>
    </div>
  );
}

function IssueList({ issues }: { issues: string[] }) {
  const setupIssue = issues.includes("missing_primary_instance") || issues.includes("missing_standard_clone_package");

  return (
    <div className="ig-devices-safe-detail">
      <span className="ig-devices-detail-label">Issues</span>
      <strong>{issues.length ? `${formatInteger(issues.length)} issue${issues.length === 1 ? "" : "s"}` : "No inventory issues"}</strong>
      <div className="ig-devices-badge-list">
        {setupIssue ? <span className="ig-devices-badge ig-devices-badge-warning">placeholder / setup issue</span> : null}
        {issues.length ? issues.map((issue) => <span className="ig-devices-badge" key={issue}>{issue}</span>) : <span className="ig-devices-badge ig-devices-badge-good">clean</span>}
      </div>
    </div>
  );
}

function AppInstancesList({ instances }: { instances: LivePhoneAppInstance[] }) {
  if (!instances.length) {
    return <div className="ig-devices-pending"><span>App instances</span><strong>No app instances</strong><p>This phone has no sanitized phone_app_instances rows in devices_overview.</p></div>;
  }

  return (
    <div className="ig-devices-account-list">
      {instances.map((instance) => (
        <div className="ig-devices-account-row" key={instance.app_instance_id || `${instance.package_name}-${instance.instance_index ?? "unknown"}`}>
          <Metric label="Index" value={instance.instance_index === null ? "unknown" : formatInteger(instance.instance_index)} />
          <Metric label="Type" value={instance.app_role || instance.instance_kind || "unknown"} />
          <Metric label="Package" value={instance.package_name || "unknown"} />
          <Metric label="Status" value={instance.status} tone={instance.status} />
          <Metric label="Account" value={instance.current_account_id || "none"} />
          <Metric label="ADB package" value={instance.adb_package_verified === null ? "unknown" : instance.adb_package_verified ? "verified" : "not verified"} tone={instance.adb_package_verified ? "ok" : "unknown"} />
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="ig-devices-summary-metric">
      <span>{label}</span>
      <strong style={tone ? { color: statusTone(tone) } : undefined}>{value}</strong>
    </span>
  );
}
