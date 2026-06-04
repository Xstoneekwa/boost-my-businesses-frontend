import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { canAccessTenantPages, requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import InstagramDashboardViewNav from "../InstagramDashboardViewNav";
import { getDmTemplatesData, type DmTemplateAccount, type DmTemplateItem } from "../dm-templates-data";
import { getRadarData } from "../radar-data";

export const dynamic = "force-dynamic";

export default async function InstagramDmTemplatesPage() {
  const userContext = await requireInstagramDashboardAccess();

  if (!canAccessTenantPages(userContext)) {
    notFound();
  }

  const [data, radarData] = await Promise.all([getDmTemplatesData(), getRadarData()]);
  const templatesByAccount = new Map<string, DmTemplateItem[]>();
  for (const template of data.templates) {
    templatesByAccount.set(template.accountId, [...(templatesByAccount.get(template.accountId) ?? []), template]);
  }

  return (
    <main className="dashboard-page ig-dm-page">
      <DashboardPageHeader
        eyebrow="Messaging"
        title="DM Templates"
        description="Personalized welcome and cold outreach messages by account/client."
        action={<InstagramDashboardViewNav active="dm-templates" badges={{ radar: radarData.notificationSummary.radarBadgeCount, "server-check": radarData.notificationSummary.serverCheckBadgeCount }} notificationItems={{ radar: radarData.notificationItems.radar, "server-check": radarData.notificationItems.serverCheck }} />}
      />

      <section className="ig-dm-source-strip" aria-label="DM Templates source status">
        <SourcePill label="Account settings" value={data.sourceDetails.accountSettings.label} detail={data.sourceDetails.accountSettings.description} />
      </section>

      <section className="ig-dm-kpis" aria-label="DM Templates summary">
        <Kpi label="Accounts" value={String(data.summary.accountsCount)} detail="Accounts with DM settings projection" />
        <Kpi label="Welcome enabled" value={String(data.summary.welcomeEnabledCount)} detail="Welcome DM enabled from account settings" />
        <Kpi label="Cold DM enabled" value={String(data.summary.outreachEnabledCount)} detail="Cold/outreach DM enabled from account settings" />
        <Kpi label="Missing messages" value={String(data.summary.missingMessageCount)} detail="Enabled templates without message text" tone="warning" />
      </section>

      <AnalyticsSectionCard
        eyebrow="Templates"
        title="Welcome and cold DM previews"
        description="Safe read-only projections from account DM settings. No raw settings payloads, global templates, or shared copy source is displayed."
      >
        {data.accounts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="ig-dm-accordion-wrap">
            <p className="ig-dm-helper">
              V1 is read-only. Use Manage then Settings / DM to edit account-scoped messages.
            </p>
            <div className="ig-dm-accordion-list">
              {data.accounts.map((account) => (
                <AccountAccordion
                  key={account.accountId}
                  account={account}
                  templates={templatesByAccount.get(account.accountId) ?? []}
                />
              ))}
            </div>
          </div>
        )}
      </AnalyticsSectionCard>

      <style>{`
        .ig-dm-page {
          max-width: 1440px;
          margin: 0 auto;
          padding: 28px clamp(16px, 3vw, 36px) 48px;
        }

        .ig-dm-source-strip,
        .ig-dm-kpis,
        .ig-dm-account-list {
          display: grid;
          gap: 14px;
        }

        .ig-dm-source-strip {
          grid-template-columns: minmax(0, 1fr);
          margin-bottom: 14px;
        }

        .ig-dm-kpis {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          margin-bottom: 18px;
        }

        .ig-dm-source-pill,
        .ig-dm-kpi,
        .ig-dm-account-row,
        .ig-dm-accordion,
        .ig-dm-template-card,
        .ig-dm-empty {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.028);
        }

        .ig-dm-source-pill,
        .ig-dm-empty {
          display: grid;
          gap: 8px;
          padding: 14px;
        }

        .ig-dm-kpi {
          min-height: 126px;
          padding: 16px;
        }

        .ig-dm-source-pill span,
        .ig-dm-kpi span,
        .ig-dm-account-row span,
        .ig-dm-template-card span,
        .ig-dm-accordion-summary span,
        .ig-dm-empty span {
          color: rgba(255,255,255,0.36);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-dm-source-pill strong,
        .ig-dm-account-row strong,
        .ig-dm-accordion-summary strong,
        .ig-dm-empty strong {
          color: #f0f0ef;
          font-size: 15px;
        }

        .ig-dm-source-pill small,
        .ig-dm-kpi small,
        .ig-dm-account-row small,
        .ig-dm-template-card p,
        .ig-dm-template-card li,
        .ig-dm-helper,
        .ig-dm-empty p {
          color: rgba(255,255,255,0.60);
          font-size: 12px;
          line-height: 1.5;
        }

        .ig-dm-kpi strong {
          display: block;
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 1.65rem;
          line-height: 1;
          margin: 16px 0 10px;
        }

        .ig-dm-account-list {
          grid-template-columns: 1fr;
        }

        .ig-dm-account-row {
          display: grid;
          grid-template-columns: 20px minmax(150px, 1.25fr) minmax(120px, 0.8fr) minmax(110px, 0.7fr) repeat(2, minmax(104px, auto));
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
        }

        .ig-dm-account-row a,
        .ig-dm-accordion-summary a,
        .ig-dm-edit-disabled {
          justify-self: start;
          min-height: 28px;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 999px;
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.72);
          display: inline-flex;
          align-items: center;
          padding: 0 10px;
          text-decoration: none;
          font-size: 11px;
          font-weight: 900;
        }

        .ig-dm-row-chevron {
          color: rgba(255,255,255,0.48);
          font-size: 18px;
          line-height: 1;
        }

        .ig-dm-accordion-wrap,
        .ig-dm-accordion-list {
          display: grid;
          gap: 10px;
        }

        .ig-dm-helper {
          margin: 0;
        }

        .ig-dm-accordion {
          overflow: hidden;
        }

        .ig-dm-accordion-summary {
          display: grid;
          grid-template-columns: 20px minmax(150px, 1.2fr) minmax(120px, 0.75fr) minmax(100px, 0.65fr) repeat(3, minmax(96px, auto));
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
          cursor: pointer;
          list-style: none;
        }

        .ig-dm-accordion-summary::-webkit-details-marker {
          display: none;
        }

        .ig-dm-accordion[open] .ig-dm-row-chevron {
          transform: rotate(90deg);
        }

        .ig-dm-accordion-panel {
          border-top: 1px solid rgba(255,255,255,0.06);
          display: grid;
          gap: 12px;
          padding: 12px;
        }

        .ig-dm-detail-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .ig-dm-meta-panel {
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          background: rgba(0,0,0,0.12);
          padding: 12px;
        }

        .ig-dm-template-card {
          display: grid;
          gap: 10px;
          padding: 12px;
        }

        .ig-dm-template-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: start;
        }

        .ig-dm-template-head h4 {
          color: #f0f0ef;
          margin: 4px 0 0;
        }

        .ig-dm-status {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.10);
          padding: 4px 8px;
          color: rgba(255,255,255,0.76);
          font-size: 11px;
          font-weight: 900;
          white-space: nowrap;
        }

        .ig-dm-status-good {
          border-color: rgba(52,211,153,0.28);
          background: rgba(52,211,153,0.10);
          color: #86efac;
        }

        .ig-dm-status-warning {
          border-color: rgba(251,191,36,0.30);
          background: rgba(251,191,36,0.10);
          color: #fcd34d;
        }

        .ig-dm-status-invalid {
          border-color: rgba(248,113,113,0.30);
          background: rgba(248,113,113,0.10);
          color: #fca5a5;
        }

        .ig-dm-message {
          min-height: 70px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          background: rgba(0,0,0,0.16);
          color: rgba(255,255,255,0.72);
          padding: 12px;
          white-space: pre-wrap;
        }

        .ig-dm-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .ig-dm-meta code {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.64);
          padding: 4px 8px;
          font-size: 11px;
        }

        .ig-dm-edit-disabled {
          color: rgba(255,255,255,0.38);
          cursor: not-allowed;
        }

        .ig-dm-template-card ul {
          margin: 0;
          padding-left: 16px;
        }

        .ig-dm-empty {
          place-items: center;
          min-height: 210px;
          text-align: center;
        }

        @media (max-width: 1180px) {
          .ig-dm-source-strip,
          .ig-dm-kpis,
          .ig-dm-account-list,
          .ig-dm-detail-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .ig-dm-account-row,
          .ig-dm-accordion-summary {
            grid-template-columns: 20px minmax(150px, 1fr) repeat(3, minmax(96px, auto));
          }
        }

        @media (max-width: 760px) {
          .ig-dm-page {
            padding: 22px 14px 40px;
          }

          .ig-dm-source-strip,
          .ig-dm-kpis,
          .ig-dm-account-list,
          .ig-dm-detail-grid,
          .ig-dm-account-row {
            grid-template-columns: 1fr;
          }

          .ig-dm-accordion-summary {
            grid-template-columns: 20px 1fr;
          }
        }
      `}</style>
    </main>
  );
}

function SourcePill({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="ig-dm-source-pill" title={detail}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Kpi({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "warning" }) {
  return (
    <article className={tone === "warning" ? "ig-dm-kpi ig-dm-status-warning" : "ig-dm-kpi"}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function AccountAccordion({ account, templates }: { account: DmTemplateAccount; templates: DmTemplateItem[] }) {
  const welcome = templates.find((template) => template.templateKind === "welcome_dm");
  const cold = templates.find((template) => template.templateKind === "cold_dm");
  const missing = templates.some((template) => template.missingMessage);

  return (
    <details className="ig-dm-accordion">
      <summary className="ig-dm-accordion-summary">
        <span className="ig-dm-row-chevron" aria-hidden>›</span>
        <div>
          <strong>@{account.username}</strong>
          <small>{account.clientName || "Client pending"} · {account.packageLabel || "Package pending"}</small>
        </div>
        <div>
          <span>Welcome</span>
          <StatusPill status={welcome?.enabled ? "good" : "neutral"} label={welcome?.enabled ? "Enabled" : "Disabled"} />
        </div>
        <div>
          <span>Cold DM</span>
          <StatusPill status={cold?.enabled ? "good" : "neutral"} label={cold?.enabled ? "Enabled" : "Disabled"} />
        </div>
        <div>
          <span>Messages</span>
          <StatusPill status={missing ? "warning" : "good"} label={missing ? "Missing" : "Configured"} />
        </div>
        <Link href="/instagram-dashboard">Review in Manage</Link>
        <Link href={`/instagram-dashboard/accounts/${account.accountId}`}>Account Detail</Link>
      </summary>
      <div className="ig-dm-accordion-panel">
        <div className="ig-dm-detail-grid">
          {welcome ? <TemplateCard template={welcome} /> : null}
          {cold ? <TemplateCard template={cold} /> : null}
        </div>
        <MetaPanel templates={templates} />
      </div>
    </details>
  );
}

function TemplateCard({ template }: { template: DmTemplateItem }) {
  const message = template.message.trim() || "No message configured.";
  const preview = template.previewMessage.trim() || "No preview available.";

  return (
    <article className="ig-dm-template-card">
      <div className="ig-dm-template-head">
        <div>
          <span>{template.templateKind}</span>
          <h4>{template.title}</h4>
        </div>
        <StatusPill status={template.enabled ? "good" : "neutral"} label={template.enabled ? "Enabled" : "Disabled"} />
      </div>

      <div>
        <span>Saved message</span>
        <p className="ig-dm-message">{message}</p>
      </div>

      <div>
        <span>Safe preview</span>
        <p className="ig-dm-message">{preview}</p>
      </div>

      <div className="ig-dm-meta">
        <code>Validation: {template.validationStatus}</code>
        <code>Variables: {template.variableStatus}</code>
      </div>

      {template.detectedVariables.length ? (
        <div className="ig-dm-meta" aria-label={`${template.title} detected variables`}>
          {template.detectedVariables.map((variable) => (
            <code key={variable.key}>{`{${variable.key}}`} · {variable.status}</code>
          ))}
        </div>
      ) : null}

      {template.validationNotes.length ? (
        <ul>
          {template.validationNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function MetaPanel({ templates }: { templates: DmTemplateItem[] }) {
  const variableStatus = templates.some((template) => template.variableStatus === "unknown")
    ? "unknown"
    : templates.some((template) => template.variableStatus === "pending")
      ? "pending"
      : "connected";
  const sourceLabel = templates[0]?.sourceLabel ?? "ig_account_settings";

  return (
    <aside className="ig-dm-meta-panel">
      <div className="ig-dm-meta">
        <code>Source: {sourceLabel}</code>
        <code>Variables: {variableStatus}</code>
        <code>Admin edit: Settings drawer</code>
      </div>
    </aside>
  );
}

function StatusPill({ status, label }: { status: "good" | "warning" | "invalid" | "neutral"; label: string }) {
  const className =
    status === "good"
      ? "ig-dm-status ig-dm-status-good"
      : status === "warning"
        ? "ig-dm-status ig-dm-status-warning"
        : status === "invalid"
          ? "ig-dm-status ig-dm-status-invalid"
          : "ig-dm-status";

  return <strong className={className}>{label}</strong>;
}

function EmptyState() {
  return (
    <div className="ig-dm-empty">
      <span>Empty state</span>
      <strong>No DM settings projection found</strong>
      <p>Welcome and outreach messages will appear here once accounts have safe DM settings rows.</p>
    </div>
  );
}
