import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsKpiCard from "@/components/restaurant-analytics/AnalyticsKpiCard";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { CommercialCrmAccessError, requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { CommercialReadModelError, getCommercialDashboardReadModel } from "@/lib/commercial/dashboard-read-model";
import { parseCommercialDashboardFilters, type CommercialDashboardSearchParams } from "@/lib/commercial/dashboard-query";
import type { CommercialBreakdownRow, CommercialDashboardReadModel, CommercialQueueLead } from "@/lib/commercial/dashboard-read-model-types";

export const dynamic = "force-dynamic";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-ZA").format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" }).format(date);
}

function label(value: string | null) {
  if (!value) return "—";
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function queryHref(model: CommercialDashboardReadModel, overrides: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  const values: Record<string, string | number | undefined> = {
    range: model.filters.range,
    campaign: model.filters.campaign,
    country: model.filters.country,
    city: model.filters.city,
    vertical: model.filters.vertical,
    subsegment: model.filters.subsegment,
    channel: model.filters.channel,
    message_angle: model.filters.messageAngle,
    template_version: model.filters.templateVersion,
    priority: model.filters.priority,
    qualification_status: model.filters.qualificationStatus,
    outreach_status: model.filters.outreachStatus,
    sales_status: model.filters.salesStatus,
    search: model.filters.search,
    date_from: model.filters.dateFrom,
    date_to: model.filters.dateTo,
    page_size: model.filters.pageSize,
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") query.set(key, String(value));
  return `/instagram-dashboard/commercial?${query.toString()}#leads`;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="commercial-empty">{children}</div>;
}

function StatusBadge({ value }: { value: string | null }) {
  return <span className={`commercial-badge commercial-badge-${value ?? "empty"}`}>{label(value)}</span>;
}

function QueueCard({ title, eyebrow, rows, empty }: { title: string; eyebrow: string; rows: CommercialQueueLead[]; empty: string }) {
  return (
    <article className="commercial-queue-card">
      <div className="commercial-queue-heading"><div><small>{eyebrow}</small><h3>{title}</h3></div><strong>{rows.length}</strong></div>
      {rows.length === 0 ? <Empty>{empty}</Empty> : (
        <div className="commercial-queue-list">
          {rows.map((lead) => (
            <Link href={`/instagram-dashboard/commercial/leads/${lead.id}`} key={lead.id}>
              <span><strong>{lead.businessName}</strong><small>{[lead.city, lead.subsegment].filter(Boolean).join(" · ") || "No segment yet"}</small></span>
              <span className="commercial-queue-meta"><StatusBadge value={lead.priority} /><b>{lead.score ?? "—"}</b></span>
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: CommercialBreakdownRow[] }) {
  return (
    <article className="commercial-breakdown">
      <h3>{title}</h3>
      {rows.length === 0 ? <Empty>No qualified cohort data for this dimension.</Empty> : (
        <div className="commercial-table-scroll"><table><thead><tr><th>Value</th><th>Q</th><th>Contacted</th><th>Replies</th><th>SQL</th><th>Demos</th><th>Paid</th><th>Paid / 100 Q</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.label}><td><strong>{row.label}</strong></td><td>{row.qualified}</td><td>{row.contacted}</td><td>{row.replies}</td><td>{row.salesQualified}</td><td>{row.demos}</td><td>{row.paid}</td><td>{row.sampleSufficient ? row.paidPer100Qualified?.toFixed(1) : "Not enough data"}</td></tr>)}</tbody>
        </table></div>
      )}
    </article>
  );
}

function DashboardFilters({ model }: { model: CommercialDashboardReadModel }) {
  const f = model.filters;
  return (
    <form className="commercial-filters" method="get">
      <label><span>Window</span><select name="range" defaultValue={f.range}><option value="7d">7 days</option><option value="14d">14 days</option><option value="30d">30 days</option><option value="all">All time</option></select></label>
      <label><span>Campaign</span><select name="campaign" defaultValue={f.campaign ?? ""}><option value="">All campaigns</option>{model.facets.campaigns.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label><span>Country</span><select name="country" defaultValue={f.country ?? ""}><option value="">All countries</option>{model.facets.countries.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>City</span><select name="city" defaultValue={f.city ?? ""}><option value="">All cities</option>{model.facets.cities.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Vertical</span><select name="vertical" defaultValue={f.vertical ?? ""}><option value="">All verticals</option>{model.facets.verticals.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Subsegment</span><select name="subsegment" defaultValue={f.subsegment ?? ""}><option value="">All subsegments</option>{model.facets.subsegments.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Channel</span><select name="channel" defaultValue={f.channel ?? ""}><option value="">All channels</option>{model.facets.channels.map((item) => <option value={item} key={item}>{label(item)}</option>)}</select></label>
      <label><span>Angle</span><select name="message_angle" defaultValue={f.messageAngle ?? ""}><option value="">All angles</option>{model.facets.angles.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Template</span><select name="template_version" defaultValue={f.templateVersion ?? ""}><option value="">All templates</option>{model.facets.templates.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Priority</span><select name="priority" defaultValue={f.priority ?? ""}><option value="">All priorities</option>{["urgent", "high", "normal", "low"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Qualification</span><select name="qualification_status" defaultValue={f.qualificationStatus ?? ""}><option value="">All qualification</option>{["discovered", "enriched", "qualified", "approved", "rejected", "not_qualified"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Outreach</span><select name="outreach_status" defaultValue={f.outreachStatus ?? ""}><option value="">All outreach</option>{["not_started", "queued", "contacted", "replied", "no_response", "stopped"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Sales</span><select name="sales_status" defaultValue={f.salesStatus ?? ""}><option value="">All sales</option>{["not_started", "sales_qualified", "demo_booked", "demo_done", "checkout_sent", "paid", "lost", "onboarding", "active_client"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="commercial-search"><span>Search</span><input name="search" defaultValue={f.search ?? ""} placeholder="Business, Instagram, contact email" /></label>
      <input type="hidden" name="page_size" value={f.pageSize} />
      <button type="submit">Apply filters</button>
      <Link href="/instagram-dashboard/commercial">Reset</Link>
    </form>
  );
}

function Dashboard({ model }: { model: CommercialDashboardReadModel }) {
  const kpiCards = [
    ["Discovered", model.kpis.discovered], ["Qualified", model.kpis.qualified], ["Approved", model.kpis.approved],
    ["Contacted", model.kpis.contacted], ["Replies", model.kpis.replies], ["Hot Leads", model.kpis.hotLeads],
    ["Demos", model.kpis.demos], ["Paid Customers", model.kpis.paid],
  ] as const;
  return (
    <main className="commercial-page">
      <DashboardPageHeader eyebrow="Founder cockpit" title="Commercial" description="What needs you, what the machine is doing, and what is winning — from one owner-only CRM source of truth." badges={[`${model.filters.range === "all" ? "All time" : model.filters.range} cohort`, "Owner only"]} />
      <DashboardFilters model={model} />

      <section className="commercial-section-title"><small>WHAT NEEDS ME</small><h2>Liam queue</h2></section>
      <section className="commercial-queues">
        <QueueCard eyebrow="Review" title="Needs Approval" rows={model.queues.needsApproval} empty="No qualified leads are waiting for approval." />
        <QueueCard eyebrow="Respond" title="Hot Responses" rows={model.queues.hotResponses} empty="No sales-qualified response is waiting." />
        <QueueCard eyebrow="Prepare" title="Upcoming Demos" rows={model.queues.upcomingDemos} empty="No demo is currently booked in the CRM." />
        <QueueCard eyebrow="Follow up" title="Needs Sales Action" rows={model.queues.needsSalesAction} empty="No reliable action-due field exists yet; this queue stays empty rather than guessing." />
      </section>

      <section className="commercial-section-title"><small>WHAT THE MACHINE IS DOING</small><h2>Pipeline health</h2></section>
      <section className="commercial-kpis">{kpiCards.map(([name, value]) => <AnalyticsKpiCard key={name} label={name} value={formatNumber(value)} detail={`${model.filters.range === "all" ? "All-time" : model.filters.range} lead-created cohort`} />)}</section>
      <section className="commercial-two-col">
        <AnalyticsSectionCard eyebrow="Primary business KPI" title="Paid customers / 100 qualified prospects" description={`Paid is sourced only from commercial_conversions. Minimum sample: ${model.metricContract.minimumQualifiedSample} qualified leads.`} tone="accent">
          <div className="commercial-primary-metric">{model.kpis.paidPer100SampleSufficient ? <><strong>{model.kpis.paidPer100Qualified?.toFixed(1)}</strong><span>customers / 100 qualified leads</span></> : <><strong>—</strong><span>Not enough data</span></>}</div>
        </AnalyticsSectionCard>
        <AnalyticsSectionCard eyebrow="Funnel" title="Qualified to Paid" description="Current coherent lead state; Paid is conversion-linked.">
          {model.funnel.length === 0 || model.kpis.qualified === 0 ? <Empty>No qualified leads in this cohort yet.</Empty> : <div className="commercial-funnel">{model.funnel.map((step, index) => <div key={step.key}><span>{index ? "↓" : ""}</span><strong>{step.label}</strong><b>{formatNumber(step.count)}</b><small>{index === 0 ? "Baseline" : `${step.fromPrevious?.toFixed(1) ?? "—"}% previous · ${step.fromQualified?.toFixed(1) ?? "—"}% qualified`}</small></div>)}</div>}
        </AnalyticsSectionCard>
      </section>

      <section className="commercial-section-title"><small>WHAT IS WINNING</small><h2>Performance breakdown</h2></section>
      <section className="commercial-breakdowns">
        <BreakdownTable title="Channel" rows={model.breakdowns.channel} /><BreakdownTable title="Angle" rows={model.breakdowns.angle} />
        <BreakdownTable title="City" rows={model.breakdowns.city} /><BreakdownTable title="Subsegment" rows={model.breakdowns.subsegment} />
        <BreakdownTable title="Template" rows={model.breakdowns.template} />
      </section>

      <section id="leads" className="commercial-section-title"><small>CRM</small><h2>Leads</h2><p>{formatNumber(model.leads.total)} results · page {model.leads.page}{model.leads.pageCount ? ` of ${model.leads.pageCount}` : ""}</p></section>
      <section className="commercial-leads-card">
        {model.leads.rows.length === 0 ? <Empty>No commercial leads match the current filters. Production remains unseeded by design.</Empty> : <div className="commercial-table-scroll"><table><thead><tr><th>Business</th><th>City</th><th>Subsegment</th><th>Score</th><th>Priority</th><th>Channel</th><th>Angle</th><th>Qualification</th><th>Outreach</th><th>Sales</th><th>Last Activity</th><th>Created</th></tr></thead><tbody>
          {model.leads.rows.map((lead) => <tr key={lead.id}><td><Link href={`/instagram-dashboard/commercial/leads/${lead.id}`}><strong>{lead.businessName}</strong><small>{lead.instagramHandle ? `@${lead.instagramHandle.replace(/^@/, "")}` : lead.campaignName}</small></Link></td><td>{lead.city ?? "—"}</td><td>{lead.subsegment ?? "—"}</td><td>{lead.score ?? "—"}</td><td><StatusBadge value={lead.priority} /></td><td>{label(lead.outreachChannel)}</td><td>{lead.messageAngle ?? "—"}</td><td><StatusBadge value={lead.qualificationStatus} /></td><td><StatusBadge value={lead.outreachStatus} /></td><td><StatusBadge value={lead.salesStatus} /></td><td>{formatDate(lead.lastActivityAt ?? lead.updatedAt)}</td><td>{formatDate(lead.createdAt)}</td></tr>)}
        </tbody></table></div>}
        <nav className="commercial-pagination" aria-label="Commercial leads pages">
          {model.leads.page > 1 ? <Link href={queryHref(model, { page: model.leads.page - 1 })}>← Previous</Link> : <span>← Previous</span>}
          <b>{model.leads.pageCount ? `${model.leads.page} / ${model.leads.pageCount}` : "0 pages"}</b>
          {model.leads.page < model.leads.pageCount ? <Link href={queryHref(model, { page: model.leads.page + 1 })}>Next →</Link> : <span>Next →</span>}
        </nav>
      </section>
      <CommercialStyles />
    </main>
  );
}

function CommercialStyles() {
  return <style>{`
    .commercial-page{max-width:1540px;margin:0 auto;padding:22px 22px 56px;color:#f0f0ee}.commercial-section-title{margin:32px 0 14px}.commercial-section-title small,.commercial-queue-heading small{display:block;color:#fbbf24;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.12em;margin-bottom:6px}.commercial-section-title h2{font:700 23px 'Syne',sans-serif}.commercial-section-title p{color:#737884;margin-top:5px}.commercial-filters{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px;border:1px solid rgba(255,255,255,.08);background:#14161b;border-radius:16px;padding:14px}.commercial-filters label{display:grid;gap:5px}.commercial-filters label span{color:#777d89;font:600 9px 'JetBrains Mono',monospace;letter-spacing:.08em;text-transform:uppercase}.commercial-filters select,.commercial-filters input{width:100%;border:1px solid rgba(255,255,255,.09);border-radius:8px;background:#0e1014;color:#dfe1e5;padding:9px 10px;font:inherit;min-width:0}.commercial-search{grid-column:span 2}.commercial-filters button,.commercial-filters>a{align-self:end;border-radius:8px;padding:10px 14px;text-align:center;text-decoration:none;font-weight:700}.commercial-filters button{border:0;background:#6558f5;color:white;cursor:pointer}.commercial-filters>a{border:1px solid rgba(255,255,255,.09);color:#a9aeba}.commercial-queues{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.commercial-queue-card,.commercial-breakdown,.commercial-leads-card{border:1px solid rgba(255,255,255,.08);background:#15171c;border-radius:16px;padding:15px;min-width:0}.commercial-queue-heading{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:12px}.commercial-queue-heading h3,.commercial-breakdown h3{font:700 16px 'Syne',sans-serif}.commercial-queue-heading>strong{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:rgba(101,88,245,.16);color:#a99fff}.commercial-queue-list{display:grid;gap:7px}.commercial-queue-list>a{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border-radius:9px;background:rgba(255,255,255,.035);color:#eef0f2;text-decoration:none}.commercial-queue-list>a>span:first-child{display:grid;gap:3px;min-width:0}.commercial-queue-list strong{overflow:hidden;text-overflow:ellipsis}.commercial-queue-list small{color:#727885;font-size:11px}.commercial-queue-meta{display:flex;gap:7px;align-items:center}.commercial-empty{border:1px dashed rgba(255,255,255,.1);border-radius:10px;padding:18px;color:#686e79;line-height:1.5;text-align:center}.commercial-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.commercial-two-col{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:12px;margin-top:12px}.commercial-primary-metric{display:flex;align-items:baseline;gap:12px;min-height:100px}.commercial-primary-metric strong{font:800 54px 'Syne',sans-serif;color:#fbbf24}.commercial-primary-metric span{color:#a9adb5}.commercial-funnel{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}.commercial-funnel>div{display:grid;gap:5px;position:relative;padding:11px;border-radius:9px;background:rgba(255,255,255,.035)}.commercial-funnel>div>span{position:absolute;left:-8px;top:35%;color:#555b67}.commercial-funnel strong{font-size:11px;color:#a8adb8}.commercial-funnel b{font:800 25px 'Syne',sans-serif}.commercial-funnel small{font-size:9px;line-height:1.35;color:#666c78}.commercial-breakdowns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.commercial-breakdown:last-child{grid-column:span 2}.commercial-breakdown h3{margin-bottom:12px}.commercial-table-scroll{overflow:auto}.commercial-table-scroll table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:11px}.commercial-table-scroll th{text-align:left;color:#626875;font:600 9px 'JetBrains Mono',monospace;letter-spacing:.06em;text-transform:uppercase;padding:9px;border-bottom:1px solid rgba(255,255,255,.08)}.commercial-table-scroll td{padding:10px 9px;border-bottom:1px solid rgba(255,255,255,.05);color:#abb0b9}.commercial-table-scroll tbody tr:last-child td{border-bottom:0}.commercial-table-scroll td:first-child{color:#eef0f2}.commercial-table-scroll td>a{display:grid;gap:3px;color:#eef0f2;text-decoration:none}.commercial-table-scroll td>a small{color:#686e79}.commercial-badge{display:inline-flex;border-radius:999px;padding:4px 7px;background:rgba(147,197,253,.09);color:#93c5fd;font-size:9px;font-weight:700;white-space:nowrap}.commercial-badge-urgent,.commercial-badge-rejected,.commercial-badge-lost{background:rgba(248,113,113,.1);color:#f87171}.commercial-badge-high,.commercial-badge-qualified,.commercial-badge-sales_qualified,.commercial-badge-demo_booked{background:rgba(251,191,36,.1);color:#fbbf24}.commercial-badge-approved,.commercial-badge-paid,.commercial-badge-active_client,.commercial-badge-replied{background:rgba(52,211,153,.1);color:#34d399}.commercial-pagination{display:flex;justify-content:space-between;align-items:center;margin-top:14px}.commercial-pagination a,.commercial-pagination span{border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 11px;color:#9298a3;text-decoration:none}.commercial-pagination span{opacity:.35}.commercial-pagination b{font-size:11px;color:#686e79}
    @media(max-width:1180px){.commercial-filters{grid-template-columns:repeat(3,minmax(0,1fr))}.commercial-queues,.commercial-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.commercial-funnel{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:760px){.commercial-page{padding:18px 14px 40px}.commercial-filters{grid-template-columns:1fr 1fr}.commercial-search{grid-column:span 2}.commercial-queues,.commercial-kpis,.commercial-two-col,.commercial-breakdowns{grid-template-columns:1fr}.commercial-breakdown:last-child{grid-column:auto}.commercial-funnel{grid-template-columns:repeat(2,minmax(0,1fr))}.commercial-primary-metric strong{font-size:42px}}
    @media(max-width:460px){.commercial-filters{grid-template-columns:1fr}.commercial-search{grid-column:auto}.commercial-queues,.commercial-kpis{grid-template-columns:1fr}}
  `}</style>;
}

export default async function CommercialDashboardPage({ searchParams }: { searchParams?: Promise<CommercialDashboardSearchParams> }) {
  const filters = parseCommercialDashboardFilters((await searchParams) ?? {});
  let model: CommercialDashboardReadModel | null = null;
  let loadFailed = false;
  try {
    await requireCommercialCrmAccess();
    model = await getCommercialDashboardReadModel(filters);
  } catch (error) {
    if (error instanceof CommercialCrmAccessError) notFound();
    if (error instanceof CommercialReadModelError) loadFailed = true;
    else throw error;
  }
  if (loadFailed || !model) return <main className="commercial-page"><DashboardPageHeader eyebrow="Founder cockpit" title="Commercial" description="The owner-only CRM read model could not be loaded." /><div className="commercial-empty" role="alert">Commercial data is temporarily unavailable. No outreach or CRM state was changed.</div><CommercialStyles /></main>;
  return <Dashboard model={model} />;
}
