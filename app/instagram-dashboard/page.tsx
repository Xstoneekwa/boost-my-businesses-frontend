import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";
import AddProfileWizard from "./AddProfileWizard";
import InstagramDashboardButtons from "./InstagramDashboardButtons";
import InstagramDashboardViewNav from "./InstagramDashboardViewNav";

export const dynamic = "force-dynamic";

type SupabaseRecord = Record<string, unknown>;

type InstagramAccountRow = {
  id: string;
  username: string;
  displayName: string;
  status: string;
  archivedAt: string;
  trashedAt: string;
  scheduledTrashAt: string;
  scheduledDeleteAt: string;
  restoredAt: string;
  deviceName: string;
  deviceUdid: string;
  campaign: string;
  lastRunStatus: string;
  totalDms: number;
  totalStoriesViewed: number;
  totalFollows: number;
  createdAt: string;
};

type DashboardData = {
  accounts: InstagramAccountRow[];
  activeAccounts: InstagramAccountRow[];
  archivedAccounts: InstagramAccountRow[];
  trashedAccounts: InstagramAccountRow[];
  recentRuns: SupabaseRecord[];
  error: string | null;
};

const emptyMarker = "—";

function readString(row: SupabaseRecord | undefined, keys: string[], fallback = emptyMarker) {
  if (!row) return fallback;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  }

  return fallback;
}

function readNumber(row: SupabaseRecord | undefined, keys: string[], fallback = 0) {
  if (!row) return fallback;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return fallback;
}

function readDate(row: SupabaseRecord | undefined, keys: string[]) {
  const raw = readString(row, keys, "");
  if (!raw) return emptyMarker;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function keyForAccount(row: SupabaseRecord | undefined) {
  if (!row) return "";
  return readString(row, ["account_id", "ig_account_id", "instagram_account_id", "id"], "");
}

function countLogs(logs: SupabaseRecord[], accountId: string, names: string[]) {
  return logs.reduce((total, log) => {
    if (keyForAccount(log) !== accountId) return total;

    const type = readString(log, ["action_type", "action", "event_type", "type"], "").toLowerCase();
    const status = readString(log, ["status", "result"], "").toLowerCase();
    const count = readNumber(log, ["count", "quantity"], 1);

    if (!names.some((name) => type.includes(name))) return total;
    if (status && ["failed", "error", "skipped"].some((blocked) => status.includes(blocked))) return total;

    return total + count;
  }, 0);
}

function latestRunForAccount(runs: SupabaseRecord[], accountId: string) {
  return runs
    .filter((run) => keyForAccount(run) === accountId)
    .sort((a, b) => {
      const aDate = new Date(readString(a, ["started_at", "created_at", "updated_at"], "")).getTime();
      const bDate = new Date(readString(b, ["started_at", "created_at", "updated_at"], "")).getTime();
      return (Number.isFinite(bDate) ? bDate : 0) - (Number.isFinite(aDate) ? aDate : 0);
    })[0];
}

async function fetchInstagramDashboardData(): Promise<DashboardData> {
  const supabase = createSupabaseClient();

  const [accountsResult, settingsResult, runsResult, logsResult, targetsResult] = await Promise.all([
    supabase.from("ig_accounts").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("ig_account_settings").select("*").limit(500),
    supabase.from("ig_runs").select("*").order("created_at", { ascending: false }).limit(250),
    supabase.from("ig_action_logs").select("*").order("created_at", { ascending: false }).limit(1000),
    supabase.from("ig_targets").select("*").limit(500),
  ]);

  const firstError =
    accountsResult.error ?? settingsResult.error ?? runsResult.error ?? logsResult.error ?? targetsResult.error;

  if (firstError) {
    return {
      accounts: [],
      activeAccounts: [],
      archivedAccounts: [],
      trashedAccounts: [],
      recentRuns: [],
      error: firstError.message,
    };
  }

  const accounts = (accountsResult.data ?? []) as SupabaseRecord[];
  const settings = (settingsResult.data ?? []) as SupabaseRecord[];
  const runs = (runsResult.data ?? []) as SupabaseRecord[];
  const logs = (logsResult.data ?? []) as SupabaseRecord[];
  const targets = (targetsResult.data ?? []) as SupabaseRecord[];

  const normalizedAccounts = accounts.map((account) => {
    const accountId = readString(account, ["id"], "");
    const accountSettings = settings.find((setting) => keyForAccount(setting) === accountId);
    const target = targets.find((item) => keyForAccount(item) === accountId);
    const latestRun = latestRunForAccount(runs, accountId);

    return {
      id: accountId,
      username: readString(account, ["username", "ig_username", "handle"], "Unknown"),
      displayName: readString(account, ["display_name", "name", "full_name"]),
      status: readString(account, ["status", "state"], "active"),
      archivedAt: readDate(account, ["archived_at"]),
      trashedAt: readDate(account, ["trashed_at"]),
      scheduledTrashAt: readDate(account, ["scheduled_trash_at"]),
      scheduledDeleteAt: readDate(account, ["scheduled_delete_at"]),
      restoredAt: readDate(account, ["restored_at"]),
      deviceName: readString(account, ["device_name", "device", "phone_name"], readString(accountSettings, ["device_name", "device", "phone_name"])),
      deviceUdid: readString(account, ["device_udid", "udid"], readString(accountSettings, ["device_udid", "udid"])),
      campaign: readString(account, ["campaign", "campaign_name"], readString(target, ["campaign", "campaign_name", "target_name", "name"])),
      lastRunStatus: readString(latestRun, ["status", "run_status", "state"], "No recent runs found."),
      totalDms:
        readNumber(account, ["total_dms", "dm_count"]) ||
        countLogs(logs, accountId, ["dm", "message"]),
      totalStoriesViewed:
        readNumber(account, ["total_stories_viewed", "stories_viewed", "story_views"]) ||
        countLogs(logs, accountId, ["story"]),
      totalFollows:
        readNumber(account, ["total_follows", "follow_count"]) ||
        countLogs(logs, accountId, ["follow"]),
      createdAt: readDate(account, ["created_at", "inserted_at"]),
    };
  });
  const activeAccounts = normalizedAccounts.filter((account) => {
    const status = normalizeStatus(account.status);
    return status !== "archived" && status !== "trashed";
  });
  const archivedAccounts = normalizedAccounts.filter((account) => normalizeStatus(account.status) === "archived");
  const trashedAccounts = normalizedAccounts.filter((account) => normalizeStatus(account.status) === "trashed");

  return {
    accounts: normalizedAccounts,
    activeAccounts,
    archivedAccounts,
    trashedAccounts,
    recentRuns: runs.slice(0, 5),
    error: null,
  };
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function normalizeStatus(status: string) {
  return status.trim().toLowerCase();
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("archived")) return "#93C5FD";
  if (normalized.includes("trashed")) return "#FCA5A5";
  if (normalized.includes("active") || normalized.includes("success") || normalized.includes("completed")) return "#34D399";
  if (normalized.includes("paused") || normalized.includes("pending") || normalized.includes("running")) return "#FBBF24";
  if (normalized.includes("error") || normalized.includes("fail") || normalized.includes("blocked")) return "#F87171";
  return "rgba(255,255,255,0.66)";
}

export default async function InstagramAutomationDashboardPage() {
  const userContext = await requireDashboardUserContext();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const data = await fetchInstagramDashboardData();
  const totals = data.accounts.reduce(
    (sum, account) => ({
      dms: sum.dms + account.totalDms,
      stories: sum.stories + account.totalStoriesViewed,
      follows: sum.follows + account.totalFollows,
    }),
    { dms: 0, stories: 0, follows: 0 },
  );

  return (
    <main className="dashboard-page ig-dashboard-page">
      <DashboardPageHeader
        eyebrow="Admin only"
        title="Instagram Automation Dashboard"
        description="Manage internal Instagram Accounts, device assignments, campaigns, recent run health, and automation activity from one private workspace."
        action={<InstagramDashboardViewNav active="manage" />}
      />

      {data.error && (
        <section className="ig-dashboard-alert" role="alert">
          <strong>Data unavailable</strong>
          <span>{data.error}</span>
        </section>
      )}

      <section className="ig-dashboard-kpis" aria-label="Instagram account totals">
        <article>
          <span>Active accounts</span>
          <strong>{formatInteger(data.activeAccounts.length)}</strong>
          <small>Visible in main list</small>
        </article>
        <article>
          <span>Total DMs</span>
          <strong>{formatInteger(totals.dms)}</strong>
          <small>Logged outreach volume</small>
        </article>
        <article>
          <span>Total stories viewed</span>
          <strong>{formatInteger(totals.stories)}</strong>
          <small>Story activity</small>
        </article>
        <article>
          <span>Total follows</span>
          <strong>{formatInteger(totals.follows)}</strong>
          <small>Follow activity</small>
        </article>
      </section>

      <AnalyticsSectionCard
        eyebrow="Accounts"
        title="Instagram Accounts"
        description="Server-rendered account inventory from Supabase with safe archive, trash, and restore lifecycle controls."
      >
        <AccountLifecycleTabs data={data} />
      </AnalyticsSectionCard>

      <AnalyticsSectionCard
        eyebrow="Runs"
        title="Recent runs"
        description="Latest automation run records from Supabase for quick operational context."
      >
        {data.recentRuns.length === 0 ? (
          <EmptyState title="No recent runs found." text="Run records will appear here once automation history exists." />
        ) : (
          <div className="ig-dashboard-runs">
            {data.recentRuns.map((run, index) => (
              <div key={`${readString(run, ["id"], String(index))}-${index}`} className="ig-dashboard-run-row">
                <span>{readString(run, ["username", "account_username", "ig_username"], readString(run, ["account_id", "ig_account_id"], "Instagram account"))}</span>
                <strong style={{ color: statusTone(readString(run, ["status", "run_status", "state"], "Unknown")) }}>
                  {readString(run, ["status", "run_status", "state"], "Unknown")}
                </strong>
                <small>{readDate(run, ["started_at", "created_at", "updated_at"])}</small>
              </div>
            ))}
          </div>
        )}
      </AnalyticsSectionCard>

      <style>{`
        .ig-dashboard-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 28px clamp(16px, 3vw, 36px) 48px;
        }

        .ig-dashboard-alert {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 18px;
          padding: 12px 14px;
          border: 1px solid rgba(248, 113, 113, 0.28);
          border-radius: 14px;
          background: rgba(248, 113, 113, 0.08);
          color: rgba(255,255,255,0.74);
          font-size: 13px;
        }

        .ig-dashboard-alert strong {
          color: #FCA5A5;
        }

        .ig-dashboard-kpis {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 18px;
        }

        .ig-dashboard-kpis article,
        .ig-dashboard-mobile-card,
        .ig-dashboard-empty,
        .ig-dashboard-run-row {
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.028);
          border-radius: 16px;
        }

        .ig-dashboard-kpis article {
          min-height: 132px;
          padding: 16px;
        }

        .ig-dashboard-kpis span,
        .ig-dashboard-table th,
        .ig-dashboard-mobile-card dt,
        .ig-dashboard-empty span {
          color: rgba(255,255,255,0.36);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-dashboard-kpis strong {
          display: block;
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 2rem;
          line-height: 1;
          margin: 16px 0 10px;
        }

        .ig-dashboard-kpis small,
        .ig-dashboard-table td,
        .ig-dashboard-mobile-card dd,
        .ig-dashboard-run-row small {
          color: rgba(255,255,255,0.60);
          font-size: 12px;
        }

        .ig-dashboard-account-tabs {
          display: grid;
          gap: 16px;
        }

        .ig-dashboard-tab-input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }

        .ig-dashboard-tab-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
        }

        .ig-dashboard-tab-list {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .ig-dashboard-tab-label {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          min-height: 36px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
          background: rgba(255,255,255,0.035);
          color: rgba(255,255,255,0.58);
          cursor: pointer;
          font-size: 12px;
          font-weight: 900;
          padding: 0 13px;
        }

        .ig-dashboard-tab-label strong {
          display: inline-grid;
          place-items: center;
          min-width: 22px;
          height: 22px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.72);
          font-size: 11px;
        }

        .ig-dashboard-tab-panel {
          display: none;
        }

        #ig-account-tab-active:checked ~ .ig-dashboard-tab-list label[for="ig-account-tab-active"],
        #ig-account-tab-archives:checked ~ .ig-dashboard-tab-list label[for="ig-account-tab-archives"],
        #ig-account-tab-trash:checked ~ .ig-dashboard-tab-list label[for="ig-account-tab-trash"] {
          border-color: rgba(245,158,11,0.40);
          background: rgba(245,158,11,0.14);
          color: #FBBF24;
        }

        #ig-account-tab-active:checked ~ .ig-dashboard-tab-panel-active,
        #ig-account-tab-archives:checked ~ .ig-dashboard-tab-panel-archives,
        #ig-account-tab-trash:checked ~ .ig-dashboard-tab-panel-trash {
          display: block;
        }

        .ig-dashboard-table-wrap {
          overflow-x: auto;
        }

        .ig-dashboard-table {
          width: 100%;
          min-width: 1320px;
          border-collapse: separate;
          border-spacing: 0 8px;
        }

        .ig-dashboard-table th,
        .ig-dashboard-table td {
          padding: 12px 10px;
          text-align: left;
          vertical-align: middle;
        }

        .ig-dashboard-table tbody tr {
          background: rgba(255,255,255,0.025);
          outline: 1px solid rgba(255,255,255,0.07);
          outline-offset: -1px;
        }

        .ig-dashboard-table tbody td:first-child {
          border-radius: 14px 0 0 14px;
        }

        .ig-dashboard-table tbody td:last-child {
          border-radius: 0 14px 14px 0;
        }

        .ig-dashboard-table strong,
        .ig-dashboard-mobile-card strong,
        .ig-dashboard-run-row span {
          color: #f0f0ef;
          font-weight: 800;
        }

        .ig-dashboard-status {
          font-weight: 800;
          white-space: nowrap;
        }

        .ig-dashboard-row-tools {
          display: flex;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
          min-width: 176px;
        }

        .ig-dashboard-tool {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          flex: 0 0 auto;
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 10px;
          background: rgba(15,23,42,0.58);
          color: rgba(226,232,240,0.72);
          cursor: pointer;
          transition:
            border-color 160ms ease,
            background 160ms ease,
            box-shadow 160ms ease,
            color 160ms ease,
            transform 160ms ease;
        }

        .ig-dashboard-tool:hover,
        .ig-dashboard-tool:focus-visible {
          border-color: rgba(148,163,184,0.34);
          color: #E2E8F0;
          background: rgba(51,65,85,0.70);
          box-shadow: 0 0 0 1px rgba(148,163,184,0.10), 0 10px 26px rgba(15,23,42,0.28);
          transform: translateY(-1px);
          outline: none;
        }

        .ig-dashboard-tool:disabled {
          cursor: not-allowed;
          opacity: 0.42;
          transform: none;
        }

        .ig-dashboard-tool:disabled:hover,
        .ig-dashboard-tool:disabled:focus-visible {
          border-color: rgba(255,255,255,0.09);
          color: rgba(226,232,240,0.72);
          background: rgba(15,23,42,0.58);
          box-shadow: none;
          transform: none;
        }

        .ig-dashboard-tool-success:hover,
        .ig-dashboard-tool-success:focus-visible {
          border-color: rgba(52,211,153,0.34);
          color: #86EFAC;
          background: rgba(22,101,52,0.20);
          box-shadow: 0 0 0 1px rgba(52,211,153,0.10), 0 10px 26px rgba(22,101,52,0.20);
        }

        .ig-dashboard-tool-neutral:hover,
        .ig-dashboard-tool-neutral:focus-visible {
          border-color: rgba(203,213,225,0.30);
          color: #CBD5E1;
          background: rgba(71,85,105,0.28);
          box-shadow: 0 0 0 1px rgba(203,213,225,0.08), 0 10px 26px rgba(15,23,42,0.26);
        }

        .ig-dashboard-tool-danger:hover,
        .ig-dashboard-tool-danger:focus-visible {
          border-color: rgba(248,113,113,0.36);
          color: #FCA5A5;
          background: rgba(127,29,29,0.22);
          box-shadow: 0 0 0 1px rgba(248,113,113,0.10), 0 10px 26px rgba(127,29,29,0.22);
        }

        .ig-dashboard-tool::after {
          content: attr(data-tooltip);
          position: absolute;
          left: 50%;
          bottom: calc(100% + 9px);
          z-index: 4;
          width: max-content;
          max-width: 160px;
          padding: 6px 8px;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 8px;
          background: rgba(7,17,31,0.96);
          color: rgba(255,255,255,0.84);
          box-shadow: 0 12px 28px rgba(0,0,0,0.24);
          font-size: 11px;
          font-weight: 800;
          opacity: 0;
          pointer-events: none;
          transform: translate(-50%, 4px);
          transition: opacity 140ms ease, transform 140ms ease;
          white-space: nowrap;
        }

        .ig-dashboard-tool::before {
          content: "";
          position: absolute;
          left: 50%;
          bottom: calc(100% + 4px);
          z-index: 5;
          width: 8px;
          height: 8px;
          background: rgba(7,17,31,0.96);
          border-right: 1px solid rgba(255,255,255,0.10);
          border-bottom: 1px solid rgba(255,255,255,0.10);
          opacity: 0;
          pointer-events: none;
          transform: translate(-50%, 4px) rotate(45deg);
          transition: opacity 140ms ease, transform 140ms ease;
        }

        .ig-dashboard-tool:hover::after,
        .ig-dashboard-tool:hover::before,
        .ig-dashboard-tool:focus-visible::after,
        .ig-dashboard-tool:focus-visible::before {
          opacity: 1;
          transform: translate(-50%, 0);
        }

        .ig-dashboard-tool:hover::before,
        .ig-dashboard-tool:focus-visible::before {
          transform: translate(-50%, 0) rotate(45deg);
        }

        .ig-dashboard-mobile-list {
          display: none;
        }

        .ig-dashboard-mobile-card {
          padding: 16px;
        }

        .ig-dashboard-mobile-card-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }

        .ig-dashboard-mobile-card-head div {
          display: grid;
          gap: 4px;
        }

        .ig-dashboard-mobile-card-head span {
          color: rgba(255,255,255,0.54);
          font-size: 12px;
          font-weight: 700;
        }

        .ig-dashboard-mobile-card dl {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin: 0 0 14px;
        }

        .ig-dashboard-mobile-card dt,
        .ig-dashboard-mobile-card dd {
          margin: 0;
        }

        .ig-dashboard-mobile-card dd {
          margin-top: 4px;
          overflow-wrap: anywhere;
        }

        .ig-dashboard-empty {
          display: grid;
          gap: 8px;
          place-items: center;
          min-height: 180px;
          padding: 28px;
          text-align: center;
        }

        .ig-dashboard-empty strong {
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 20px;
        }

        .ig-dashboard-empty p {
          color: rgba(255,255,255,0.48);
          font-size: 13px;
          line-height: 1.6;
          margin: 0;
          max-width: 420px;
        }

        .ig-dashboard-runs {
          display: grid;
          gap: 8px;
        }

        .ig-dashboard-run-row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
        }

        @media (max-width: 1120px) {
          .ig-dashboard-kpis {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .ig-dashboard-page {
            padding: 22px 14px 40px;
          }

          .ig-dashboard-kpis {
            grid-template-columns: 1fr;
          }

          .ig-dashboard-table-wrap {
            display: none;
          }

          .ig-dashboard-mobile-list {
            display: grid;
            gap: 12px;
          }

          .ig-dashboard-mobile-card dl,
          .ig-dashboard-run-row {
            grid-template-columns: 1fr;
          }

          .ig-dashboard-row-tools {
            min-width: 0;
          }

          .ig-dashboard-tool {
            width: 36px;
            height: 36px;
          }
        }
      `}</style>
    </main>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="ig-dashboard-empty">
      <span>Empty state</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function AccountLifecycleTabs({ data }: { data: DashboardData }) {
  const tabs = [
    {
      id: "active",
      label: "Active",
      accounts: data.activeAccounts,
      emptyTitle: "No active Instagram accounts found.",
      emptyText: "Restore archived or trashed accounts to return them to the active dashboard.",
    },
    {
      id: "archives",
      label: "Archives",
      accounts: data.archivedAccounts,
      emptyTitle: "No archived accounts.",
      emptyText: "Archived accounts stay recoverable here before they are eligible to move to trash.",
    },
    {
      id: "trash",
      label: "Trash",
      accounts: data.trashedAccounts,
      emptyTitle: "Trash is empty.",
      emptyText: "Trashed accounts stay recoverable here before future permanent cleanup is enabled.",
    },
  ] as const;

  if (data.accounts.length === 0) {
    return <EmptyState title="No Instagram accounts found." text="Add account records in Supabase to populate this admin dashboard." />;
  }

  return (
    <div className="ig-dashboard-account-tabs">
      {tabs.map((tab, index) => (
        <input
          key={`${tab.id}-input`}
          id={`ig-account-tab-${tab.id}`}
          className="ig-dashboard-tab-input"
          type="radio"
          name="ig-account-tab"
          defaultChecked={index === 0}
        />
      ))}
      <div className="ig-dashboard-tab-toolbar">
        <div className="ig-dashboard-tab-list" role="tablist" aria-label="Instagram account lifecycle views">
          {tabs.map((tab) => (
            <label key={`${tab.id}-label`} htmlFor={`ig-account-tab-${tab.id}`} className="ig-dashboard-tab-label">
              <span>{tab.label}</span>
              <strong>{formatInteger(tab.accounts.length)}</strong>
            </label>
          ))}
        </div>
        <AddProfileWizard />
      </div>
      {tabs.map((tab) => (
        <section key={tab.id} className={`ig-dashboard-tab-panel ig-dashboard-tab-panel-${tab.id}`}>
          <AccountList
            accounts={tab.accounts}
            mode={tab.id === "archives" ? "archived" : tab.id === "trash" ? "trashed" : "active"}
            emptyTitle={tab.emptyTitle}
            emptyText={tab.emptyText}
          />
        </section>
      ))}
    </div>
  );
}

function AccountList({
  accounts,
  mode,
  emptyTitle,
  emptyText,
}: {
  accounts: InstagramAccountRow[];
  mode: "active" | "archived" | "trashed";
  emptyTitle: string;
  emptyText: string;
}) {
  if (accounts.length === 0) {
    return <EmptyState title={emptyTitle} text={emptyText} />;
  }

  return (
    <>
      <div className="ig-dashboard-table-wrap">
        <table className="ig-dashboard-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Display name</th>
              <th>Status</th>
              <th>Device name</th>
              <th>Device UDID</th>
              <th>Campaign</th>
              <th>Last run status</th>
              <th>Total DMs</th>
              <th>Total stories viewed</th>
              <th>Total follows</th>
              <th>{mode === "archived" ? "Scheduled trash" : mode === "trashed" ? "Scheduled delete" : "Created at"}</th>
              <th>Controls</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id || account.username}>
                <td>
                  <strong>{account.username}</strong>
                </td>
                <td>{account.displayName}</td>
                <td>
                  <span className="ig-dashboard-status" style={{ color: statusTone(account.status) }}>
                    {account.status}
                  </span>
                </td>
                <td>{account.deviceName}</td>
                <td>{account.deviceUdid}</td>
                <td>{account.campaign}</td>
                <td>
                  <span className="ig-dashboard-status" style={{ color: statusTone(account.lastRunStatus) }}>
                    {account.lastRunStatus}
                  </span>
                </td>
                <td>{formatInteger(account.totalDms)}</td>
                <td>{formatInteger(account.totalStoriesViewed)}</td>
                <td>{formatInteger(account.totalFollows)}</td>
                <td>{mode === "archived" ? account.scheduledTrashAt : mode === "trashed" ? account.scheduledDeleteAt : account.createdAt}</td>
                <td>
                  <InstagramDashboardButtons accountId={account.id || account.username} username={account.username} mode={mode} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ig-dashboard-mobile-list">
        {accounts.map((account) => (
          <article className="ig-dashboard-mobile-card" key={`${account.id || account.username}-mobile`}>
            <div className="ig-dashboard-mobile-card-head">
              <div>
                <strong>{account.username}</strong>
                <span>{account.displayName}</span>
              </div>
              <span style={{ color: statusTone(account.status) }}>{account.status}</span>
            </div>
            <dl>
              <div>
                <dt>Device name</dt>
                <dd>{account.deviceName}</dd>
              </div>
              <div>
                <dt>Device UDID</dt>
                <dd>{account.deviceUdid}</dd>
              </div>
              <div>
                <dt>Campaign</dt>
                <dd>{account.campaign}</dd>
              </div>
              <div>
                <dt>Last run status</dt>
                <dd style={{ color: statusTone(account.lastRunStatus) }}>{account.lastRunStatus}</dd>
              </div>
              <div>
                <dt>Total DMs</dt>
                <dd>{formatInteger(account.totalDms)}</dd>
              </div>
              <div>
                <dt>Total stories viewed</dt>
                <dd>{formatInteger(account.totalStoriesViewed)}</dd>
              </div>
              <div>
                <dt>Total follows</dt>
                <dd>{formatInteger(account.totalFollows)}</dd>
              </div>
              <div>
                <dt>{mode === "archived" ? "Scheduled trash" : mode === "trashed" ? "Scheduled delete" : "Created at"}</dt>
                <dd>{mode === "archived" ? account.scheduledTrashAt : mode === "trashed" ? account.scheduledDeleteAt : account.createdAt}</dd>
              </div>
            </dl>
            <InstagramDashboardButtons accountId={account.id || account.username} username={account.username} mode={mode} />
          </article>
        ))}
      </div>
    </>
  );
}
