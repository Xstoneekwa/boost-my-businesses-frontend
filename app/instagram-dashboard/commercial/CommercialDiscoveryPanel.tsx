"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COMMERCIAL_DISCOVERY_CITIES, COMMERCIAL_DISCOVERY_SUBSEGMENTS, type CommercialDiscoveryReadModel } from "@/lib/commercial/discovery-contract";

export default function CommercialDiscoveryPanel({ initialModel }: { initialModel: CommercialDiscoveryReadModel }) {
  const router = useRouter(); const [model, setModel] = useState(initialModel); const [error, setError] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  const active = model.latest.some((run) => run.status === "queued" || run.status === "running");
  async function refresh() {
    const response = await fetch("/api/instagram-dashboard/commercial/discovery/runs", { cache: "no-store" });
    const payload = await response.json(); if (response.ok && payload.data) setModel(payload.data);
    return response.ok;
  }
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => { refresh().then((ok) => { if (ok) router.refresh(); }).catch(() => undefined); }, 3000);
    return () => window.clearInterval(interval);
  }, [active, router]);

  function submit(formData: FormData) {
    setError(null); startTransition(async () => {
      const response = await fetch("/api/instagram-dashboard/commercial/discovery/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city: formData.get("city"), subsegment: formData.get("subsegment"), maxProspects: 3, idempotencyKey: `commercial-discovery:${crypto.randomUUID()}` }) });
      const payload = await response.json(); if (!response.ok) { setError(payload.error || "Discovery could not start."); return; }
      await refresh(); router.refresh();
    });
  }
  return <section className="commercial-discovery-panel">
    <div className="commercial-discovery-copy"><small>OWNER-TRIGGERED DISCOVERY</small><h3>Beauty & Aesthetics · South Africa</h3><p>Discovers, enriches and scores up to 3 public prospects in this certified canary. It stops at Needs Approval; no message is sent.</p></div>
    <form action={submit}>
      <label><span>City</span><select name="city" defaultValue="Johannesburg">{COMMERCIAL_DISCOVERY_CITIES.map((city) => <option key={city}>{city}</option>)}</select></label>
      <label><span>Subsegment</span><select name="subsegment" defaultValue=""><option value="">All approved subsegments</option>{COMMERCIAL_DISCOVERY_SUBSEGMENTS.map((segment) => <option key={segment}>{segment}</option>)}</select></label>
      <label><span>Canary</span><input value="3 prospects" readOnly /></label>
      <button disabled={pending || active} type="submit">{active ? "Discovery running…" : pending ? "Starting…" : "Run Discovery"}</button>
    </form>
    {error ? <p className="commercial-discovery-error" role="alert">{error}</p> : null}
    <div className="commercial-discovery-summary"><span><b>{model.summary.discovered}</b> discovered</span><span><b>{model.summary.enriched}</b> enriched</span><span><b>{model.summary.scored}</b> scored</span><span><b>{model.summary.p1}</b> P1</span><span><b>{model.summary.p2}</b> P2</span></div>
    {model.latest[0] ? <div className="commercial-discovery-latest"><strong>Latest: {model.latest[0].city}{model.latest[0].subsegment ? ` · ${model.latest[0].subsegment}` : ""}</strong><span className={`commercial-badge commercial-badge-${model.latest[0].status}`}>{model.latest[0].status.replaceAll("_", " ")}</span><small>{model.latest[0].discoveredCount} found · {model.latest[0].duplicateCount} duplicates · {model.latest[0].enrichedCount} enriched · {model.latest[0].scoredCount} scored · {model.latest[0].p1Count} P1 · {model.latest[0].p2Count} P2 · {model.latest[0].p3Count} P3 · {model.latest[0].hardRejectedCount} hard rejected · {model.latest[0].errorCount} errors</small></div> : <p className="commercial-detail-empty">No discovery run yet.</p>}
  </section>;
}
