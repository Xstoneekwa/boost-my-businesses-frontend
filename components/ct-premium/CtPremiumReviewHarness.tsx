"use client";

import { useMemo, useState } from "react";
import { syntheticReviewBatch, syntheticReviewProposals } from "@/lib/ct-premium/fixtures";
import type { CtProposal, ProposalId } from "@/lib/ct-premium/types";
import CtPremiumReviewPreview from "./CtPremiumReviewPreview";

type Scenario = "preparing" | "ready" | "partial" | "frozen" | "canceled" | "completed" | "error" | "near_expiry" | "expired" | "empty";

const SCENARIOS: readonly Scenario[] = ["preparing", "ready", "partial", "frozen", "canceled", "completed", "error", "near_expiry", "expired", "empty"];

function scenarioData(scenario: Scenario) {
  if (scenario === "empty") return { batch: null, proposals: [] as CtProposal[], now: new Date("2026-07-03T00:00:00.000Z"), error: false };
  const status = scenario === "preparing" ? "preparing" : scenario === "frozen" ? "frozen" : scenario === "canceled" ? "canceled" : scenario === "completed" ? "completed" : "ready_for_review";
  const proposals = syntheticReviewProposals(scenario === "partial" ? ["accepted", "rejected", ...Array.from({ length: 8 }, () => "pending" as const)] : undefined);
  return {
    batch: syntheticReviewBatch(status),
    proposals: [...proposals],
    now: new Date(scenario === "near_expiry" ? "2026-07-05T22:00:00.000Z" : scenario === "expired" ? "2026-07-06T00:00:00.000Z" : "2026-07-03T00:00:00.000Z"),
    error: scenario === "error",
  };
}

export default function CtPremiumReviewHarness() {
  const [scenario, setScenario] = useState<Scenario>("ready");
  const [lang, setLang] = useState<"fr" | "en">("fr");
  const initial = useMemo(() => scenarioData(scenario), [scenario]);
  const [decisions, setDecisions] = useState<Record<string, CtProposal["status"]>>({});
  const proposals = initial.proposals.map((proposal) => ({ ...proposal, status: decisions[proposal.id] ?? proposal.status }));
  const decide = (ids: readonly ProposalId[], status: "accepted" | "rejected") => setDecisions((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, status])) }));
  return (
    <main style={{ minHeight: "100vh", padding: 24, background: "#f4f4f5" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <label>Scenario <select value={scenario} onChange={(event) => { setScenario(event.target.value as Scenario); setDecisions({}); }}>{SCENARIOS.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Language <select value={lang} onChange={(event) => setLang(event.target.value as "fr" | "en")}><option value="fr">FR</option><option value="en">EN</option></select></label>
      </div>
      <CtPremiumReviewPreview tenantId={initial.batch?.tenantId ?? "tenant_fixture_preview" as never} accountId={initial.batch?.accountId ?? "account_fixture_preview" as never} batch={initial.batch} proposals={proposals} lang={lang} now={initial.now} error={initial.error} onAccept={(id) => decide([id], "accepted")} onReject={(id) => decide([id], "rejected")} onBulkAccept={(ids) => decide(ids, "accepted")} onBulkReject={(ids) => decide(ids, "rejected")} />
    </main>
  );
}
