import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { CommercialCrmAccessError, requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { getCommercialLeadDetail } from "@/lib/commercial/dashboard-read-model";
import type { CommercialLeadDetail } from "@/lib/commercial/dashboard-read-model-types";

export const dynamic = "force-dynamic";

function pretty(value: string | null) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase()) : "—";
}

function date(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" }).format(parsed);
}

function DetailGrid({ items }: { items: Array<[string, React.ReactNode]> }) {
  return <dl className="commercial-detail-grid">{items.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || "—"}</dd></div>)}</dl>;
}

function SafeContext({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value);
  if (!entries.length) return <p className="commercial-detail-empty">No context captured.</p>;
  return <dl className="commercial-context">{entries.slice(0, 12).map(([key, raw]) => <div key={key}><dt>{pretty(key)}</dt><dd>{typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? String(raw) : "Structured context available"}</dd></div>)}</dl>;
}

function safeReturnPath(value: string | string[] | undefined) {
  const candidate = typeof value === "string" ? value : "";
  return candidate.startsWith("/instagram-dashboard/commercial") && !candidate.startsWith("//")
    ? candidate
    : "/instagram-dashboard/commercial#review-queue";
}

function LeadDetail({ lead, returnPath }: { lead: CommercialLeadDetail; returnPath: string }) {
  return <main className="commercial-detail-page">
    <Link className="commercial-back" href={returnPath}>← Back to review queue</Link>
    <DashboardPageHeader eyebrow={`${lead.campaign.code} · Lead detail`} title={lead.business.name} description="Complete owner-only CRM projection, conversion linkage, and bounded event timeline." badges={[pretty(lead.qualification.status), pretty(lead.sales.status)]} />
    <section className="commercial-detail-columns">
      <AnalyticsSectionCard eyebrow="Business" title="Company"><DetailGrid items={[
        ["Business", lead.business.name], ["Website", lead.business.website ? <a href={lead.business.website} target="_blank" rel="noreferrer">{lead.business.website}</a> : "—"],
        ["Instagram", lead.business.instagramHandle ? `@${lead.business.instagramHandle.replace(/^@/, "")}` : "—"], ["City", lead.business.city],
        ["Country", lead.business.country], ["Vertical", lead.business.vertical], ["Subsegment", lead.business.subsegment], ["Source", lead.business.source],
      ]} /></AnalyticsSectionCard>
      <AnalyticsSectionCard eyebrow="Contact" title="Primary contact">{lead.contact ? <DetailGrid items={[["Name", lead.contact.name], ["Role", lead.contact.role], ["Business email", lead.contact.email], ["Instagram", lead.contact.instagramHandle], ["Preferred channel", pretty(lead.contact.preferredChannel)]]} /> : <p className="commercial-detail-empty">No primary contact is linked.</p>}</AnalyticsSectionCard>
      <AnalyticsSectionCard eyebrow="Qualification" title="Review state">
        <DetailGrid items={[["Score", lead.qualification.score?.toString() ?? "—"], ["Priority", pretty(lead.qualification.priority)], ["Status", pretty(lead.qualification.status)], ["Approved by", lead.qualification.approvedBy], ["Approved at", date(lead.qualification.approvedAt)]]} />
        <div className="commercial-context-columns"><div><h3>Personalization</h3><SafeContext value={lead.qualification.personalizationContext} /></div><div><h3>Audience</h3><SafeContext value={lead.qualification.audienceContext} /></div></div>
      </AnalyticsSectionCard>
      <AnalyticsSectionCard eyebrow="Outreach + Sales" title="Commercial state"><DetailGrid items={[["Channel", pretty(lead.outreach.channel)], ["Angle", lead.outreach.angle], ["Template", lead.outreach.templateVersion], ["Outreach", pretty(lead.outreach.status)], ["Sales", pretty(lead.sales.status)], ["Sales owner", lead.sales.ownerUserId]]} /></AnalyticsSectionCard>
    </section>

    <section className="commercial-conversion"><AnalyticsSectionCard eyebrow="Conversion linkage" title="Lead → Client" tone={lead.conversion ? "accent" : "default"}>
      {lead.conversion ? <><div className="commercial-link-chain"><strong>{lead.business.name}</strong><span>→</span><Link href="/instagram-dashboard/client-accounts">Client {lead.conversion.clientId}</Link>{lead.conversion.instagramAccountIds.map((accountId) => <span className="commercial-account-chain" key={accountId}>→ <Link href={`/instagram-dashboard/accounts/${encodeURIComponent(accountId)}`}>Instagram account {accountId}</Link></span>)}</div><DetailGrid items={[["Converted", date(lead.conversion.convertedAt)], ["Package", lead.conversion.packageReference], ["Entitlement", lead.conversion.entitlementId], ["Checkout session", lead.conversion.checkoutSessionId], ["Stripe billing profile", lead.conversion.stripeBillingProfileId], ["Stripe subscription", lead.conversion.stripeSubscriptionId]]} /></> : <p className="commercial-detail-empty">This lead has no canonical commercial_conversions row.</p>}
    </AnalyticsSectionCard></section>

    <section className="commercial-timeline"><AnalyticsSectionCard eyebrow="Audit trail" title="Commercial timeline" description="Latest 100 events, newest first. Metadata is summarized and sensitive-looking keys are redacted.">
      {lead.timeline.length === 0 ? <p className="commercial-detail-empty">No commercial events recorded for this lead.</p> : <ol>{lead.timeline.map((event) => <li key={event.id}><span className="commercial-timeline-dot" /><div className="commercial-timeline-head"><strong>{pretty(event.eventType)}</strong><time>{date(event.occurredAt)}</time></div><p>{pretty(event.actorType)}{event.actorUserId ? ` · ${event.actorUserId}` : ""}</p>{event.metadataSummary.length ? <dl>{event.metadataSummary.map((item) => <div key={item.key}><dt>{pretty(item.key)}</dt><dd>{item.value}</dd></div>)}</dl> : null}</li>)}</ol>}
    </AnalyticsSectionCard></section>
    <p className="commercial-detail-stamp">Created {date(lead.createdAt)} · Updated {date(lead.updatedAt)}</p>
    <style>{`
      .commercial-detail-page{max-width:1320px;margin:0 auto;padding:22px 22px 56px;color:#f0f0ee}.commercial-back{display:inline-block;color:#8b91a0;text-decoration:none;margin-bottom:20px}.commercial-detail-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.commercial-conversion,.commercial-timeline{margin-top:12px}.commercial-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:rgba(255,255,255,.06);border-radius:10px;overflow:hidden}.commercial-detail-grid>div{background:#15171c;padding:11px;min-width:0}.commercial-detail-grid dt,.commercial-context dt,.commercial-timeline dl dt{color:#656b77;font:600 9px 'JetBrains Mono',monospace;letter-spacing:.07em;text-transform:uppercase;margin-bottom:5px}.commercial-detail-grid dd{color:#d8dbe0;overflow-wrap:anywhere}.commercial-detail-grid a,.commercial-link-chain a,.commercial-account-chain a{color:#a99fff}.commercial-detail-empty{border:1px dashed rgba(255,255,255,.1);border-radius:9px;padding:16px;color:#686e79}.commercial-context-columns{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}.commercial-context-columns h3{font:700 13px 'Syne',sans-serif;margin-bottom:8px}.commercial-context{display:grid;gap:6px}.commercial-context>div{padding:9px;border-radius:8px;background:rgba(255,255,255,.035)}.commercial-context dd{color:#a9aeb8;line-height:1.4}.commercial-link-chain{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;font-size:13px}.commercial-link-chain>span{color:#fbbf24}.commercial-account-chain{display:flex;gap:10px}.commercial-timeline ol{list-style:none;display:grid}.commercial-timeline li{position:relative;padding:0 0 22px 28px;border-left:1px solid rgba(255,255,255,.1);margin-left:7px}.commercial-timeline li:last-child{border-left-color:transparent;padding-bottom:0}.commercial-timeline-dot{position:absolute;left:-5px;top:3px;width:9px;height:9px;border-radius:50%;background:#6558f5;box-shadow:0 0 0 4px rgba(101,88,245,.13)}.commercial-timeline-head{display:flex;justify-content:space-between;gap:12px}.commercial-timeline-head time,.commercial-timeline li>p{color:#6e7480;font-size:11px}.commercial-timeline li>p{margin-top:4px}.commercial-timeline dl{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.commercial-timeline dl>div{border:1px solid rgba(255,255,255,.07);border-radius:7px;padding:7px 9px}.commercial-timeline dl dd{color:#a7acb5;font-size:11px}.commercial-detail-stamp{color:#555b66;font-size:11px;margin-top:14px;text-align:right}@media(max-width:760px){.commercial-detail-page{padding:18px 14px 40px}.commercial-detail-columns,.commercial-context-columns{grid-template-columns:1fr}.commercial-detail-grid{grid-template-columns:1fr}.commercial-timeline-head{display:grid}.commercial-timeline-head time{order:-1}}
    `}</style>
  </main>;
}

export default async function CommercialLeadPage({ params, searchParams }: { params: Promise<{ leadId: string }>; searchParams?: Promise<{ return_to?: string | string[] }> }) {
  let lead: CommercialLeadDetail | null = null;
  try {
    await requireCommercialCrmAccess();
    const { leadId } = await params;
    lead = await getCommercialLeadDetail(leadId);
    if (!lead) notFound();
  } catch (error) {
    if (error instanceof CommercialCrmAccessError) notFound();
    throw error;
  }
  if (!lead) notFound();
  const returnPath = safeReturnPath((await searchParams)?.return_to);
  return <LeadDetail lead={lead} returnPath={returnPath} />;
}
