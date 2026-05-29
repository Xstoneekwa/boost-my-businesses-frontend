import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import InstagramDashboardViewNav from "../../InstagramDashboardViewNav";
import {
  formatDateTime,
  getManageData,
  statusTone,
  type ManageAccount,
} from "../../manage-data";
import {
  getRadarData,
  type RadarWarning,
} from "../../radar-data";

export const dynamic = "force-dynamic";

type DetailSource = "manage" | "radar" | "server-check";

function parseSource(value: string | string[] | undefined): DetailSource {
  const source = Array.isArray(value) ? value[0] : value;
  if (source === "radar" || source === "server-check") return source;
  return "manage";
}

function findAccount(accounts: ManageAccount[], accountId: string) {
  const decodedId = decodeURIComponent(accountId).toLowerCase();
  return accounts.find((account) => account.accountId.toLowerCase() === decodedId || account.username.toLowerCase() === decodedId);
}

function linkedWarnings(account: ManageAccount, warnings: RadarWarning[]) {
  return warnings
    .filter((warning) => warning.accountId === account.accountId || warning.username?.toLowerCase() === account.username.toLowerCase())
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))
    .slice(0, 6);
}

function returnHref(source: DetailSource) {
  if (source === "radar") return "/instagram-dashboard/radar";
  if (source === "server-check") return "/instagram-dashboard/server-check";
  return "/instagram-dashboard";
}

function returnLabel(source: DetailSource) {
  if (source === "radar") return "Back to Radar";
  if (source === "server-check") return "Back to Server Check";
  return "Back to Manage";
}

export default async function InstagramAccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams?: Promise<{ from?: string | string[] }>;
}) {
  const userContext = await requireDashboardUserContext();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const [{ accountId }, query] = await Promise.all([params, searchParams]);
  const source = parseSource(query?.from);
  const [manageData, radarData] = await Promise.all([getManageData(), getRadarData()]);
  const account = findAccount(manageData.allAccounts, accountId);

  if (!account) {
    notFound();
  }

  const warnings = linkedWarnings(account, radarData.warnings);

  return (
    <main className="dashboard-page ig-account-detail-page">
      <DashboardPageHeader
        eyebrow="Account detail"
        title={account.username}
        description="Read-only account detail assembled from the Manage and Radar data contracts. Settings and operational actions remain in Manage controls."
        action={<InstagramDashboardViewNav active="manage" badges={{ radar: radarData.notificationSummary.radarBadgeCount, "server-check": radarData.notificationSummary.serverCheckBadgeCount }} notificationItems={{ radar: radarData.notificationItems.radar, "server-check": radarData.notificationItems.serverCheck }} />}
      />

      <nav className="ig-account-detail-nav" aria-label="Account detail navigation">
        <Link href={returnHref(source)}>{returnLabel(source)}</Link>
        <Link href="/instagram-dashboard">Manage</Link>
        <Link href="/instagram-dashboard/radar">Radar</Link>
        <Link href="/instagram-dashboard/server-check">Server Check</Link>
      </nav>

      {(manageData.errors.length > 0 || radarData.errors.length > 0) && (
        <section className="ig-account-detail-alert" role="alert">
          <strong>Some sources are partial</strong>
          <span>{[...manageData.errors, ...radarData.errors].join(" · ")}</span>
        </section>
      )}

      <section className="ig-account-detail-hero" aria-label="Account summary">
        <article>
          <span>Client</span>
          <strong>{account.clientName ?? "unknown"}</strong>
          <small>{account.emailDisplay}</small>
        </article>
        <article>
          <span>Admin status</span>
          <strong style={{ color: statusTone(account.adminStatus) }}>{account.adminStatus}</strong>
          <small>{account.customerStatus} · {account.subscriptionStatus}</small>
        </article>
        <article>
          <span>Package</span>
          <strong>{account.packageLabel}</strong>
          <small>{account.entitlementSummary}</small>
        </article>
        <article>
          <span>Source</span>
          <strong>{account.sourceLabel}</strong>
          <small>{manageData.summary.sourceStatus.backendApi.label}</small>
        </article>
      </section>

      <section className="ig-account-detail-grid">
        <AnalyticsSectionCard
          eyebrow="Profile"
          title="Instagram profile"
          description="Safe public profile metadata only. Avatar and username verification are optional and never include raw provider metadata."
        >
          <FieldGrid
            fields={[
              ["Username verification", account.instagramVerificationStatus ?? "pending"],
              ["Verification reason", account.usernameVerificationReason ?? "pending source"],
              ["Canonical username", account.instagramCanonicalUsername ?? account.username],
              ["Avatar", account.profileImageUrl ? "available" : "pending"],
            ]}
          />
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          eyebrow="Status"
          title="Operational status"
          description="Read-only account health and workflow status. Actions remain in the Manage row controls."
        >
          <FieldGrid
            fields={[
              ["Login status", account.loginStatus],
              ["Provisioning", account.provisioningStatus],
              ["Onboarding", account.onboardingStatus],
              ["Automation health", account.blockingCampaign ? "blocking campaign" : account.latestIncidentSeverity],
              ["Pending actions", String(account.pendingActionsCount)],
              ["Latest incident", account.latestIncidentSeverity],
              ["Last safe update", formatDateTime(account.lastSafeUpdate)],
            ]}
          />
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          eyebrow="Credentials"
          title="Credentials safe"
          description="Safe credential statuses only. No password, secret reference, or vault identifier is rendered."
        >
          <FieldGrid
            fields={[
              ["Configured", account.credentialsConfigured === null ? "unknown" : account.credentialsConfigured ? "configured" : "missing"],
              ["Credentials status", account.credentialsStatus],
              ["Reauth required", account.reauthRequired ? "yes" : "no"],
              ["Password display", account.passwordDisplay],
              ["Two-factor display", account.twoFactorDisplay],
            ]}
          />
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          eyebrow="Assignment"
          title="Phone and Mac host"
          description="Safe assignment labels only. Internal device identifiers and ports are intentionally not displayed."
        >
          <FieldGrid
            fields={[
              ["Phone", account.phoneName],
              ["Mac/host", account.macHostName],
              ["Source label", account.sourceLabel],
            ]}
          />
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          eyebrow="Signals"
          title="Recent signals"
          description="Linked warning signals from the Radar contract. Raw logs and metadata stay out of this read-only detail."
        >
          <WarningList warnings={warnings} />
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          eyebrow="Targets"
          title="Targets / CT summary"
          description="Read-only placeholder until target account quality and CT summaries are connected to the detail contract."
        >
          <PendingState title="Targets source pending" text="Target account and CT summary data is not connected to Account Detail yet." />
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          eyebrow="DM"
          title="DM / templates summary"
          description="Read-only placeholder until DM templates and messaging summaries are connected to the detail contract."
        >
          <PendingState title="DM source pending" text="DM template summary data is not connected to Account Detail yet." />
        </AnalyticsSectionCard>
      </section>

      <style>{`
        .ig-account-detail-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 28px clamp(16px, 3vw, 36px) 48px;
        }

        .ig-account-detail-nav {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }

        .ig-account-detail-nav a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 34px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
          background: rgba(255,255,255,0.035);
          color: rgba(255,255,255,0.68);
          font-size: 12px;
          font-weight: 900;
          padding: 0 12px;
          text-decoration: none;
        }

        .ig-account-detail-nav a:hover,
        .ig-account-detail-nav a:focus-visible {
          border-color: rgba(245,158,11,0.42);
          color: #FBBF24;
          outline: none;
        }

        .ig-account-detail-alert {
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

        .ig-account-detail-alert strong {
          color: #FCA5A5;
        }

        .ig-account-detail-hero,
        .ig-account-detail-grid {
          display: grid;
          gap: 14px;
        }

        .ig-account-detail-hero {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          margin-bottom: 18px;
        }

        .ig-account-detail-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: start;
        }

        .ig-account-detail-hero article,
        .ig-account-detail-field-grid,
        .ig-account-detail-warning,
        .ig-account-detail-pending {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.028);
        }

        .ig-account-detail-hero article {
          min-height: 128px;
          padding: 16px;
        }

        .ig-account-detail-hero span,
        .ig-account-detail-hero small,
        .ig-account-detail-field span,
        .ig-account-detail-warning span,
        .ig-account-detail-pending span {
          color: rgba(255,255,255,0.36);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-account-detail-hero strong {
          display: block;
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 1.35rem;
          line-height: 1.1;
          margin: 16px 0 10px;
          overflow-wrap: anywhere;
        }

        .ig-account-detail-field-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          padding: 14px;
        }

        .ig-account-detail-field strong,
        .ig-account-detail-warning strong,
        .ig-account-detail-pending strong {
          display: block;
          color: rgba(255,255,255,0.78);
          font-size: 13px;
          margin-top: 5px;
          overflow-wrap: anywhere;
        }

        .ig-account-detail-warning-list {
          display: grid;
          gap: 10px;
        }

        .ig-account-detail-warning,
        .ig-account-detail-pending {
          display: grid;
          gap: 8px;
          padding: 14px;
        }

        .ig-account-detail-warning p,
        .ig-account-detail-pending p {
          color: rgba(255,255,255,0.58);
          font-size: 13px;
          line-height: 1.5;
          margin: 0;
        }

        @media (max-width: 1120px) {
          .ig-account-detail-hero,
          .ig-account-detail-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .ig-account-detail-page {
            padding: 22px 14px 40px;
          }

          .ig-account-detail-hero,
          .ig-account-detail-grid,
          .ig-account-detail-field-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

function FieldGrid({ fields }: { fields: Array<[string, string]> }) {
  return (
    <div className="ig-account-detail-field-grid">
      {fields.map(([label, value]) => (
        <div key={label} className="ig-account-detail-field">
          <span>{label}</span>
          <strong>{value || "unknown"}</strong>
        </div>
      ))}
    </div>
  );
}

function WarningList({ warnings }: { warnings: RadarWarning[] }) {
  if (!warnings.length) {
    return <PendingState title="No linked warning signals" text="No linked warnings found from the current Radar contract." />;
  }

  return (
    <div className="ig-account-detail-warning-list">
      {warnings.map((warning) => (
        <article key={warning.id} className="ig-account-detail-warning">
          <span>{warning.warningType}</span>
          <strong style={{ color: statusTone(warning.severity) }}>{warning.severity}</strong>
          <p>{warning.message}</p>
          <p>{warning.sourceLabel} · {formatDateTime(warning.timestamp)}</p>
          <p>{warning.phoneName} · {warning.macHostName}</p>
        </article>
      ))}
    </div>
  );
}

function PendingState({ title, text }: { title: string; text: string }) {
  return (
    <div className="ig-account-detail-pending">
      <span>Pending source</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
