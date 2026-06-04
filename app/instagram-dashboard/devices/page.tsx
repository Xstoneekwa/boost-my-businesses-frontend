import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import InstagramDashboardViewNav from "../InstagramDashboardViewNav";
import { formatDateTime, formatInteger, statusTone } from "../manage-data";
import { getLiveDevicesOverviewData, type LivePhoneAppInstance, type LivePhoneDevice, type LivePhoneInventorySummary } from "../devices-live-data";
import { getRadarData } from "../radar-data";
import AddPhoneForm from "./AddPhoneForm";

export const dynamic = "force-dynamic";

export default async function InstagramDevicesPage() {
  const userContext = await requireInstagramDashboardAccess();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const [data, radarData] = await Promise.all([getLiveDevicesOverviewData(), getRadarData()]);
  const phones = data.phone_devices.length ? data.phone_devices : data.items;

  return (
    <main className="dashboard-page ig-devices-page">
      <DashboardPageHeader
        eyebrow="Inventory"
        title="Devices / Phones"
        description="Register and monitor physical phones used by the Instagram automation runtime."
        action={<InstagramDashboardViewNav active="devices" badges={{ radar: radarData.notificationSummary.radarBadgeCount, "server-check": radarData.notificationSummary.serverCheckBadgeCount }} notificationItems={{ radar: radarData.notificationItems.radar, "server-check": radarData.notificationItems.serverCheck }} />}
      />

      {data.errors.length > 0 && (
        <section className="ig-devices-alert" role="alert">
          <strong>Device data partially unavailable</strong>
          <span>{data.errors.join(" · ")}</span>
        </section>
      )}

      <DevicesKpis summary={data.phone_inventory_summary} />

      <AnalyticsSectionCard
        eyebrow="Inventory action"
        title="Add phone"
        description="Register a physical phone and its standard Instagram app instances. No credentials, assignments, runs, or provisioning are started here."
      >
        <AddPhoneExplainer />
        <AddPhoneForm />
      </AnalyticsSectionCard>

      <AnalyticsSectionCard
        eyebrow="Registered phones"
        title="Live phone inventory"
        description="Live inventory comes from phone_devices and phone_app_instances. ADB online/offline is only shown when heartbeat data exists; otherwise status remains unknown."
      >
        <RegisteredPhonesList phones={phones} />
      </AnalyticsSectionCard>

      <style>{`
        .ig-devices-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 28px clamp(16px, 3vw, 36px) 48px;
        }

        .ig-devices-alert {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 18px;
          padding: 12px 14px;
          border: 1px solid rgba(248,113,113,0.28);
          border-radius: 14px;
          background: rgba(248,113,113,0.08);
          color: rgba(255,255,255,0.74);
          font-size: 13px;
        }

        .ig-devices-alert strong {
          color: #FCA5A5;
        }

        .ig-devices-kpis,
        .ig-devices-grid {
          display: grid;
          gap: 14px;
        }

        .ig-devices-kpis {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          margin-bottom: 18px;
        }

        .ig-devices-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: start;
          margin-bottom: 18px;
        }

        .ig-devices-kpi,
        .ig-devices-host,
        .ig-devices-pending,
        .ig-add-phone-explainer {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.028);
        }

        .ig-devices-host,
        .ig-devices-pending,
        .ig-add-phone-explainer {
          display: grid;
          gap: 8px;
          padding: 14px;
        }

        .ig-add-phone-explainer {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .ig-add-phone-explainer h3 {
          color: #f0f0ef;
          font-size: 13px;
          margin: 0 0 8px;
        }

        .ig-add-phone-explainer ul {
          color: rgba(255,255,255,0.62);
          display: grid;
          font-size: 12px;
          gap: 5px;
          margin: 0;
          padding-left: 18px;
        }

        .ig-add-phone-form {
          display: grid;
          gap: 14px;
        }

        .ig-add-phone-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .ig-add-phone-field {
          display: grid;
          gap: 7px;
        }

        .ig-add-phone-field span {
          color: rgba(255,255,255,0.42);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-add-phone-field input,
        .ig-add-phone-field select,
        .ig-add-phone-field textarea {
          width: 100%;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 12px;
          background: rgba(0,0,0,0.18);
          color: #f0f0ef;
          font: inherit;
          font-size: 13px;
          padding: 11px 12px;
        }

        .ig-add-phone-field textarea {
          min-height: 82px;
          resize: vertical;
        }

        .ig-add-phone-field input:focus-visible,
        .ig-add-phone-field select:focus-visible,
        .ig-add-phone-field textarea:focus-visible {
          border-color: rgba(251,191,36,0.52);
          outline: none;
        }

        .ig-add-phone-actions {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }

        .ig-add-phone-actions button {
          border: 1px solid rgba(245,158,11,0.45);
          border-radius: 999px;
          background: linear-gradient(135deg, #F59E0B, #FBBF24);
          color: #1c1204;
          cursor: pointer;
          font-size: 13px;
          font-weight: 900;
          padding: 10px 16px;
        }

        .ig-add-phone-actions button:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .ig-add-phone-actions small {
          color: rgba(255,255,255,0.46);
          font-size: 12px;
        }

        .ig-add-phone-message {
          border-radius: 12px;
          margin: 0;
          padding: 10px 12px;
          font-size: 12px;
        }

        .ig-add-phone-message span,
        .ig-add-phone-message strong {
          display: block;
        }

        .ig-add-phone-message span {
          margin-top: 4px;
        }

        .ig-add-phone-error {
          border: 1px solid rgba(248,113,113,0.28);
          background: rgba(248,113,113,0.08);
          color: #FCA5A5;
        }

        .ig-add-phone-success {
          border: 1px solid rgba(52,211,153,0.24);
          background: rgba(52,211,153,0.08);
          color: #86EFAC;
        }

        .ig-devices-kpi {
          min-height: 126px;
          padding: 16px;
        }

        .ig-devices-kpi span,
        .ig-devices-host span,
        .ig-devices-pending span {
          color: rgba(255,255,255,0.36);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-devices-kpi strong {
          display: block;
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 1.8rem;
          line-height: 1;
          margin: 16px 0 10px;
        }

        .ig-devices-kpi small,
        .ig-devices-host p,
        .ig-devices-pending p {
          color: rgba(255,255,255,0.60);
          font-size: 12px;
        }

        .ig-devices-accordion-list {
          display: grid;
          gap: 10px;
        }

        .ig-devices-accordion {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.028);
          overflow: hidden;
        }

        .ig-devices-accordion summary {
          display: grid;
          grid-template-columns: auto minmax(180px, 1.4fr) repeat(5, minmax(110px, 1fr));
          gap: 10px;
          align-items: center;
          min-height: 58px;
          padding: 12px 14px;
          cursor: pointer;
          list-style: none;
        }

        .ig-devices-accordion summary::-webkit-details-marker {
          display: none;
        }

        .ig-devices-accordion summary:hover,
        .ig-devices-accordion summary:focus-visible {
          background: rgba(245,158,11,0.06);
          outline: none;
        }

        .ig-devices-chevron {
          color: rgba(255,255,255,0.44);
          font-size: 16px;
          font-weight: 900;
          transition: transform 160ms ease;
        }

        .ig-devices-accordion[open] > summary .ig-devices-chevron {
          transform: rotate(90deg);
        }

        .ig-devices-summary-title {
          display: grid;
          gap: 4px;
          min-width: 0;
        }

        .ig-devices-summary-title strong {
          color: #f0f0ef;
          font-size: 14px;
          overflow-wrap: anywhere;
        }

        .ig-devices-summary-metric {
          display: grid;
          gap: 4px;
          min-width: 0;
        }

        .ig-devices-summary-metric span,
        .ig-devices-detail-label {
          color: rgba(255,255,255,0.36);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-devices-summary-metric strong {
          color: rgba(255,255,255,0.72);
          font-size: 12px;
          overflow-wrap: anywhere;
        }

        .ig-devices-accordion-body {
          display: grid;
          gap: 10px;
          padding: 0 14px 14px;
        }

        .ig-devices-phone-nested {
          background: rgba(255,255,255,0.025);
        }

        .ig-devices-phone-nested summary {
          grid-template-columns: auto minmax(170px, 1.4fr) repeat(6, minmax(96px, 1fr));
          min-height: 54px;
        }

        .ig-devices-account-list {
          display: grid;
          gap: 8px;
        }

        .ig-devices-badge-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .ig-devices-badge {
          border: 1px solid rgba(251,191,36,0.24);
          border-radius: 999px;
          background: rgba(251,191,36,0.08);
          color: #FDE68A;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.02em;
          padding: 4px 8px;
        }

        .ig-devices-badge-good {
          border-color: rgba(52,211,153,0.24);
          background: rgba(52,211,153,0.08);
          color: #86EFAC;
        }

        .ig-devices-badge-warning {
          border-color: rgba(248,113,113,0.26);
          background: rgba(248,113,113,0.08);
          color: #FCA5A5;
        }

        .ig-devices-account-row {
          display: grid;
          grid-template-columns: minmax(160px, 1.4fr) repeat(5, minmax(110px, 1fr));
          gap: 10px;
          align-items: start;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          background: rgba(255,255,255,0.025);
          padding: 10px 12px;
        }

        .ig-devices-phone-detail-grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 10px;
        }

        .ig-devices-safe-detail {
          display: grid;
          gap: 6px;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          background: rgba(255,255,255,0.025);
          padding: 12px;
        }

        .ig-devices-host strong,
        .ig-devices-pending strong {
          color: #f0f0ef;
          font-size: 15px;
        }

        .ig-devices-account-link {
          color: #f0f0ef;
          font-weight: 900;
          text-decoration: none;
        }

        .ig-devices-account-link:hover,
        .ig-devices-account-link:focus-visible {
          color: #FBBF24;
          outline: none;
        }

        @media (max-width: 1120px) {
          .ig-devices-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .ig-devices-kpis {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .ig-devices-accordion summary,
          .ig-devices-phone-nested summary,
          .ig-devices-account-row,
          .ig-add-phone-grid,
          .ig-add-phone-explainer,
          .ig-devices-phone-detail-grid {
            grid-template-columns: 1fr;
          }

          .ig-devices-chevron {
            justify-self: start;
          }
        }

        @media (max-width: 760px) {
          .ig-devices-page {
            padding: 22px 14px 40px;
          }

          .ig-devices-kpis,
          .ig-devices-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

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

function AddPhoneExplainer() {
  return (
    <div className="ig-add-phone-explainer">
      <div>
        <h3>Add phone does</h3>
        <ul>
          <li>Registers the phone in phone_devices.</li>
          <li>Creates com.instagram.android, com.instagram.androie, com.instagram.androif, and com.instagram.androig app instances.</li>
          <li>Uses adb_serial as the stable runtime key.</li>
          <li>Stores hub_label and hub_port as ops metadata.</li>
        </ul>
      </div>
      <div>
        <h3>Add phone does not</h3>
        <ul>
          <li>Detect ADB automatically in V1.</li>
          <li>Verify installed Android packages yet.</li>
          <li>Create Android clones, assignments, runs, login, provisioning, or credentials.</li>
        </ul>
      </div>
    </div>
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
