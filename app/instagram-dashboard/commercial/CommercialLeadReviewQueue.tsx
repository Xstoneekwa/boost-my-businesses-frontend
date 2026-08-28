"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  COMMERCIAL_REVIEW_ANGLES,
  COMMERCIAL_REVIEW_CHANNELS,
  COMMERCIAL_REVIEW_PRIORITIES,
  type CommercialReviewAction,
  type CommercialReviewLead,
  type CommercialReviewMutationResult,
  type CommercialReviewPatch,
  type CommercialReviewReadModel,
} from "@/lib/commercial/lead-review-contract";
import { commercialReviewLabel, commercialReviewPriorityLabel, nextCommercialReviewLeadId } from "@/lib/commercial/lead-review-ui";
import CommercialLeadDetail from "./CommercialLeadDetail";
import CommercialLeadQueueList from "./CommercialLeadQueueList";
import styles from "./CommercialLeadReviewWorkspace.module.css";
import type { HumanReviewFeedback } from "@/lib/commercial/human-review-feedback";

type MutationResponse =
  | { ok: true; data: CommercialReviewMutationResult }
  | { ok: false; code?: string; error?: string };

export default function CommercialLeadReviewQueue({
  initialModel,
  returnPath,
  cities,
  subsegments,
  canary,
}: {
  initialModel: CommercialReviewReadModel;
  returnPath: string;
  cities: string[];
  subsegments: string[];
  canary: HumanReviewFeedback;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, startNavigation] = useTransition();
  const [model, setModel] = useState(initialModel);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(initialModel.filters.search ?? "");
  const [reviewSessionActive, setReviewSessionActive] = useState(false);
  const [reviewReadyId, setReviewReadyId] = useState<string | null>(null);

  useEffect(() => {
    setModel(initialModel);
    setSearchDraft(initialModel.filters.search ?? "");
  }, [initialModel]);

  function navigate(updates: Record<string, string | number | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    startNavigation(() => router.replace(`${pathname}?${next.toString()}#review-queue`, { scroll: false }));
  }

  useEffect(() => {
    const current = initialModel.filters.search ?? "";
    if (searchDraft.trim() === current) return;
    const timeout = window.setTimeout(() => navigate({ review_search: searchDraft.trim() || null, review_page: null, review_lead: null }), 350);
    return () => window.clearTimeout(timeout);
    // URL parameters are the source of truth; navigation intentionally follows the debounced draft only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft, initialModel.filters.search]);

  const selected = model.selectedLead;
  const selectedId = selected?.id ?? null;
  const member = canary.members.find((m) => m.id === selectedId);
  const memberId = member?.id;
  const reviewReady = !member || (reviewSessionActive && reviewReadyId === selectedId);
  useEffect(() => {
    if (!reviewSessionActive || !memberId || memberId === reviewReadyId) return;
    let cancelled = false;
    fetch(`/api/instagram-dashboard/commercial/leads/${memberId}/review/start`, { method: "POST" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error("start_failed");
        if (!cancelled) setReviewReadyId(memberId);
      }).catch(() => {
        if (!cancelled) {
          setReviewSessionActive(false);
          setFeedback({ tone: "error", message: "Review could not start. Retry before making a decision; nothing was changed." });
        }
      });
    return () => { cancelled = true; };
  }, [reviewSessionActive, memberId, reviewReadyId]);
  useEffect(() => {
    if (canary.approvedWithoutPreview <= canary.terminalFailures || pendingId) return;
    const timer = window.setInterval(() => router.refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [canary.approvedWithoutPreview, canary.terminalFailures, pendingId, router]);
  const selectedIndex = useMemo(() => model.items.findIndex((item) => item.id === selectedId), [model.items, selectedId]);

  function selectLead(id: string) {
    if (pendingId || isNavigating) return;
    setMobileDetailOpen(true);
    if (id !== selectedId) navigate({ review_lead: id });
  }

  function moveSelection(direction: 1 | -1) {
    const id = nextCommercialReviewLeadId(model.items, selectedId, direction);
    if (id && id !== selectedId) selectLead(id);
  }

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (!["j", "k", "arrowdown", "arrowup"].includes(key)) return;
      event.preventDefault();
      moveSelection(key === "j" || key === "arrowdown" ? 1 : -1);
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  });

  async function mutate(lead: CommercialReviewLead, action: CommercialReviewAction, patch: CommercialReviewPatch) {
    if (pendingId || !reviewReady || isNavigating) return false;
    setPendingId(lead.id);
    setFeedback(null);
    const nextId = model.items[selectedIndex + 1]?.id ?? model.items[selectedIndex - 1]?.id ?? null;
    try {
      const response = await fetch(`/api/instagram-dashboard/commercial/leads/${lead.id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          expectedVersion: lead.version,
          idempotencyKey: `commercial-review:${action}:${lead.id}:${lead.version}:${crypto.randomUUID()}`,
          patch,
        }),
      });
      const payload = await response.json() as MutationResponse;
      if (!response.ok || !payload.ok) {
        const code = payload.ok ? "commercial_review_unavailable" : payload.code;
        if (response.status === 409) router.refresh();
        throw new Error(code === "commercial_review_conflict" ? "This lead changed in another tab. The latest state is being reloaded." : "The decision was not saved. No CRM state was changed.");
      }
      if (action === "update_context") {
        setFeedback({ tone: "success", message: `Review context saved for ${lead.businessName}.` });
        router.refresh();
      } else {
        setModel((current) => ({
          ...current,
          items: current.items.filter((item) => item.id !== lead.id),
          selectedLead: null,
          pagination: { ...current.pagination, total: Math.max(0, current.pagination.total - 1) },
          metrics: {
            ...current.metrics,
            readyForOutreach: current.metrics.readyForOutreach + (action === "approve" ? 1 : 0),
            p1: Math.max(0, current.metrics.p1 - (lead.priority === "urgent" ? 1 : 0)),
            p2: Math.max(0, current.metrics.p2 - (lead.priority === "high" ? 1 : 0)),
          },
        }));
        setFeedback({ tone: "success", message: action === "approve" ? `${lead.businessName} approved. Its dry-run preview is being generated automatically. Nothing was sent.` : `${lead.businessName} rejected. The decision is terminal for this lead.` });
        const previousPage = !nextId && model.pagination.page > 1 ? model.pagination.page - 1 : model.pagination.page;
        navigate({ review_lead: nextId, review_page: previousPage === 1 ? null : previousPage });
      }
      return true;
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "The review request failed closed." });
      return false;
    } finally {
      setPendingId(null);
    }
  }

  return <section id="review-queue" className={styles.workspace} aria-labelledby="review-workflow-title">
    <div className={styles.heading}>
      <div className={styles.headingCopy}><small className={styles.eyebrow}>REVIEW</small><h2 id="review-workflow-title">Needs Approval</h2><p>{model.filters.scope === "canary" ? "Frozen 25-lead canary · ignores global cohort filters · queue filters still apply" : "All pending leads · P1/P2 first"} · no outreach.</p></div>
      <div className={styles.metrics} aria-label="Approval queue summary"><span><b>{model.pagination.total}</b>Total</span><span><b>{model.metrics.p1}</b>P1</span><span><b>{model.metrics.p2}</b>P2</span></div>
    </div>

    {feedback ? <div className={`${styles.feedback} ${feedback.tone === "success" ? styles.feedbackSuccess : styles.feedbackError}`} role="status">{feedback.message}</div> : null}
    <span className={styles.screenReaderOnly} aria-live="polite">{isNavigating ? "Updating lead qualification workspace" : "Lead qualification workspace ready"}</span>

    <div className={styles.toolbar}>
      <select aria-label="Review scope" value={model.filters.scope ?? "all"} onChange={(event) => navigate({ review_scope: event.target.value, review_page: null, review_lead: null })}><option value="canary">Canary · 15 P1 + 10 P2</option><option value="all">All pending leads</option></select>
      <label className={styles.searchField}><span aria-hidden="true">⌕</span><input aria-label="Search business or Instagram" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={120} placeholder="Search business / Instagram…" /></label>
      <select aria-label="Priority filter" value={model.filters.priority ?? ""} onChange={(event) => navigate({ review_priority: event.target.value || null, review_page: null, review_lead: null })}><option value="">All priorities</option>{COMMERCIAL_REVIEW_PRIORITIES.map((value) => <option value={value} key={value}>{commercialReviewPriorityLabel(value)} · {commercialReviewLabel(value)}</option>)}</select>
      <select aria-label="City filter" value={model.filters.city ?? ""} onChange={(event) => navigate({ review_city: event.target.value || null, review_page: null, review_lead: null })}><option value="">All cities</option>{cities.map((value) => <option value={value} key={value}>{value}</option>)}</select>
      <select aria-label="Subsegment filter" value={model.filters.subsegment ?? ""} onChange={(event) => navigate({ review_subsegment: event.target.value || null, review_page: null, review_lead: null })}><option value="">All subsegments</option>{subsegments.map((value) => <option value={value} key={value}>{value}</option>)}</select>
      <select aria-label="Recommended channel filter" value={model.filters.channel ?? ""} onChange={(event) => navigate({ review_channel: event.target.value || null, review_page: null, review_lead: null })}><option value="">All channels</option>{COMMERCIAL_REVIEW_CHANNELS.map((value) => <option value={value} key={value}>{commercialReviewLabel(value)}</option>)}</select>
      <select aria-label="Recommended angle filter" value={model.filters.angle ?? ""} onChange={(event) => navigate({ review_angle: event.target.value || null, review_page: null, review_lead: null })}><option value="">All angles</option>{COMMERCIAL_REVIEW_ANGLES.map((value) => <option value={value} key={value}>Angle {value}</option>)}</select>
      <select aria-label="Minimum score filter" value={model.filters.minimumScore ?? ""} onChange={(event) => navigate({ review_score: event.target.value || null, review_page: null, review_lead: null })}><option value="">All scores</option>{[90, 80, 70, 60].map((value) => <option value={value} key={value}>{(value / 10).toFixed(1)}+ / 10</option>)}</select>
      <select aria-label="Sort leads" value={model.filters.sort} onChange={(event) => navigate({ review_sort: event.target.value === "priority" ? null : event.target.value, review_page: null, review_lead: null })}><option value="priority">P1/P2 first</option><option value="score">Highest score</option><option value="newest">Newest</option><option value="oldest">Oldest</option></select>
    </div>

    <div className={styles.shell} aria-busy={isNavigating || Boolean(pendingId)}>
      <div className={`${styles.queueSlot} ${mobileDetailOpen ? styles.queueHiddenMobile : ""}`}>
        <CommercialLeadQueueList items={model.items} selectedId={selectedId} total={model.pagination.total} page={model.pagination.page} pageCount={model.pagination.pageCount} navigating={isNavigating} onSelect={selectLead} onPage={(page) => navigate({ review_page: page === 1 ? null : page, review_lead: null })} />
      </div>
      <CommercialLeadDetail key={`${selectedId ?? "empty"}:${selected?.version ?? 0}`} lead={selected} pending={pendingId === selectedId || isNavigating} canaryMember={member} reviewReady={reviewReady} starting={reviewSessionActive && !reviewReady} onStartReview={() => setReviewSessionActive(true)} returnPath={returnPath} mobileOpen={mobileDetailOpen} previousDisabled={selectedIndex <= 0} nextDisabled={selectedIndex < 0 || selectedIndex >= model.items.length - 1} onBack={() => setMobileDetailOpen(false)} onPrevious={() => moveSelection(-1)} onNext={() => moveSelection(1)} onMutate={mutate} />
    </div>

    <div className={styles.readySummary} role="note"><div><small className={styles.eyebrow}>APPROVED · READ ONLY</small><h3>Ready for Outreach</h3><p>Approved leads move into the dry-run message workspace below. No send action exists here.</p></div><div><strong>{model.metrics.readyForOutreach}</strong><span>{model.metrics.readyForOutreach === 1 ? "lead ready" : "leads ready"}</span><a href="#outreach-workspace">Review previews ↓</a></div></div>
  </section>;
}
