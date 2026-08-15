"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import {
  COMMERCIAL_OUTREACH_STATUS_TABS,
  type CommercialOutreachItem,
  type CommercialOutreachMutationAction,
  type CommercialOutreachReadModel,
  type CommercialOutreachStatusTab,
} from "@/lib/commercial/outreach-contract";
import { filterOutreachQueueItems, nextOutreachItemId, outreachStateLabel } from "@/lib/commercial/outreach-ui";
import CommercialMessagePreview from "./CommercialMessagePreview";
import CommercialOutreachContext from "./CommercialOutreachContext";
import CommercialOutreachQueueList from "./CommercialOutreachQueueList";
import styles from "./CommercialOutreachWorkspace.module.css";

type ApiResponse = { ok: true; data: Record<string, unknown> } | { ok: false; code?: string; error?: string };

const TAB_LABELS: Record<CommercialOutreachStatusTab, string> = {
  ready: "Ready",
  approved: "Approved dry run",
  failed: "Failed closed",
  cancelled: "Cancelled",
  all: "All",
};

export default function CommercialOutreachQueue({ initialModel }: { initialModel: CommercialOutreachReadModel }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, startNavigation] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(initialModel.filters.search ?? "");

  useEffect(() => setSearchDraft(initialModel.filters.search ?? ""), [initialModel.filters.search]);

  const items = useMemo(() => filterOutreachQueueItems(initialModel.items, searchDraft), [initialModel.items, searchDraft]);
  const selected = initialModel.selectedItem;
  const selectedId = selected?.id ?? null;
  const metrics = initialModel.metrics;
  const tabCounts: Record<CommercialOutreachStatusTab, number | null> = {
    ready: metrics.readyForReview,
    approved: metrics.approvedDryRun,
    failed: metrics.generationFailed,
    cancelled: metrics.cancelled,
    all: initialModel.filters.status === "all" ? initialModel.pagination.total : null,
  };

  function navigate(updates: Record<string, string | number | null>, replace = true) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    startNavigation(() => {
      const href = `${pathname}?${next.toString()}#outreach-workspace`;
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  }

  function selectItem(id: string) {
    if (id === selectedId) {
      setMobilePreviewOpen(true);
      return;
    }
    setMobilePreviewOpen(true);
    navigate({ outreach_item: id });
  }

  function selectTab(tab: CommercialOutreachStatusTab) {
    setMobilePreviewOpen(false);
    setContextOpen(false);
    navigate({ outreach_tab: tab === "ready" ? null : tab, outreach_page: null, outreach_item: null });
  }

  async function mutate(item: CommercialOutreachItem, action: CommercialOutreachMutationAction, patch: Record<string, unknown> = {}) {
    if (pendingId) return;
    setPendingId(item.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/instagram-dashboard/commercial/outreach/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedVersion: item.version, idempotencyKey: `commercial-outreach:${action}:${item.id}:${item.version}:${crypto.randomUUID()}`, patch }),
      });
      const payload = await response.json() as ApiResponse;
      if (!response.ok || !payload.ok) throw new Error(response.status === 409 ? "This preview changed in another tab. The latest state is being reloaded." : "The outreach action failed closed; nothing was sent.");
      setFeedback({ tone: "success", text: action === "approve_message" ? "Preview approved into QUEUED_DRY_RUN. No email or DM was sent." : "Dry-run outreach state updated. Nothing was sent." });
      setContextOpen(false);
      router.refresh();
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "The request failed closed." });
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function processNow() {
    if (processing) return;
    setProcessing(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/instagram-dashboard/commercial/outreach/process", { method: "POST" });
      const payload = await response.json() as ApiResponse;
      if (!response.ok || !payload.ok) throw new Error("Dry-run generation failed closed. Nothing was sent.");
      setFeedback({ tone: "success", text: "The next approved leads were generated for review. No email or Instagram DM was sent." });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Dry-run generation is unavailable." });
    } finally {
      setProcessing(false);
    }
  }

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button, [contenteditable='true']")) return;
      if (event.key === "Escape") {
        setContextOpen(false);
        return;
      }
      if (event.key.toLowerCase() !== "j" && event.key.toLowerCase() !== "k") return;
      const id = nextOutreachItemId(items, selectedId, event.key.toLowerCase() === "j" ? 1 : -1);
      if (id && id !== selectedId) {
        event.preventDefault();
        selectItem(id);
      }
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  });

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ outreach_search: searchDraft.trim() || null, outreach_page: null, outreach_item: null });
  }

  return <section id="outreach-workspace" className={styles.workspace} aria-labelledby="outreach-title">
    <div className={styles.heading}>
      <div className={styles.headingCopy}><small className={styles.eyebrow}>OUTREACH · DRY RUN ONLY</small><h2 id="outreach-title">Message review workspace</h2><p>Queue → Preview → Context → Decision. One selected message at a time, with the evidence and owner controls kept in view.</p></div>
      <button type="button" className={styles.primaryButton} onClick={processNow} disabled={processing || Boolean(pendingId)}>{processing ? "Generating…" : "Generate next previews"}</button>
    </div>

    <div className={styles.safetyLock} role="note"><strong>DELIVERY LOCKED</strong><span>Real email OFF</span><span>Instagram DM OFF</span><span>Phone Farm DM OFF</span><span>Approval remains dry-run</span></div>

    <div className={styles.metrics} aria-label="Outreach summary">
      <button type="button" className={styles.metricButton} onClick={() => selectTab("all")}><b>{metrics.generated}</b><span>Generated</span></button>
      <button type="button" className={`${styles.metricButton} ${initialModel.filters.status === "ready" ? styles.metricActive : ""}`} onClick={() => selectTab("ready")}><b>{metrics.readyForReview}</b><span>Ready</span></button>
      <button type="button" className={`${styles.metricButton} ${initialModel.filters.status === "approved" ? styles.metricActive : ""}`} onClick={() => selectTab("approved")}><b>{metrics.approvedDryRun}</b><span>Approved dry run</span></button>
      <button type="button" className={`${styles.metricButton} ${initialModel.filters.status === "failed" ? styles.metricActive : ""}`} onClick={() => selectTab("failed")}><b>{metrics.generationFailed}</b><span>Failed closed</span></button>
      <button type="button" className={`${styles.metricButton} ${initialModel.filters.status === "cancelled" ? styles.metricActive : ""}`} onClick={() => selectTab("cancelled")}><b>{metrics.cancelled}</b><span>Cancelled</span></button>
    </div>

    {feedback ? <div className={`${styles.feedback} ${feedback.tone === "success" ? styles.feedbackSuccess : styles.feedbackError}`} role="status">{feedback.text}</div> : null}
    <span className={styles.screenReaderOnly} aria-live="polite">{isNavigating ? "Updating outreach workspace" : "Outreach workspace ready"}</span>

    <div className={styles.toolbar}>
      <div className={styles.tabs} role="tablist" aria-label="Outreach status">
        {COMMERCIAL_OUTREACH_STATUS_TABS.map((tab) => <button key={tab} type="button" role="tab" aria-selected={initialModel.filters.status === tab} className={`${styles.tab} ${initialModel.filters.status === tab ? styles.tabActive : ""}`} onClick={() => selectTab(tab)}>{TAB_LABELS[tab]}{tabCounts[tab] !== null ? <span className={styles.tabCount}>{tabCounts[tab]}</span> : null}</button>)}
      </div>
      <form className={styles.filters} onSubmit={submitSearch}>
        <label className={styles.searchField}><span aria-hidden="true">⌕</span><input aria-label="Search this outreach page" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={120} placeholder="Search this page…" /></label>
        <select aria-label="Channel filter" value={initialModel.filters.channel ?? ""} onChange={(event) => navigate({ outreach_channel: event.target.value || null, outreach_page: null, outreach_item: null })}><option value="">All channels</option>{initialModel.facets.channels.map((value) => <option value={value} key={value}>{outreachStateLabel(value)}</option>)}</select>
        <select aria-label="Angle filter" value={initialModel.filters.angle ?? ""} onChange={(event) => navigate({ outreach_angle: event.target.value || null, outreach_page: null, outreach_item: null })}><option value="">All angles</option>{initialModel.facets.angles.map((value) => <option value={value} key={value}>Angle {value}</option>)}</select>
        <select aria-label="Template filter" value={initialModel.filters.template ?? ""} onChange={(event) => navigate({ outreach_template: event.target.value || null, outreach_page: null, outreach_item: null })}><option value="">All templates</option>{initialModel.facets.templates.map((value) => <option value={value} key={value}>{value}</option>)}</select>
        <select aria-label="Sort previews" value={initialModel.filters.sort} onChange={(event) => navigate({ outreach_sort: event.target.value === "newest" ? null : event.target.value, outreach_page: null, outreach_item: null })}><option value="newest">Newest first</option><option value="confidence">Confidence</option></select>
        <button type="submit" className={styles.screenReaderOnly}>Apply search</button>
      </form>
    </div>

    <div className={styles.shell} aria-busy={isNavigating || Boolean(pendingId)}>
      <div className={`${styles.queueSlot} ${mobilePreviewOpen ? styles.queueHiddenMobile : ""}`}>
        <CommercialOutreachQueueList items={items} selectedId={selectedId} total={initialModel.pagination.total} page={initialModel.pagination.page} pageCount={initialModel.pagination.pageCount} navigating={isNavigating} onSelect={selectItem} onPage={(page) => navigate({ outreach_page: page, outreach_item: null })} />
      </div>
      <CommercialMessagePreview item={selected} mobileOpen={mobilePreviewOpen} onBack={() => { setMobilePreviewOpen(false); setContextOpen(false); }} onOpenContext={() => setContextOpen(true)} />
      <CommercialOutreachContext key={`${selectedId ?? "empty"}:${selected?.version ?? 0}`} item={selected} open={contextOpen} pending={pendingId === selectedId} onClose={() => setContextOpen(false)} onMutate={mutate} />
    </div>
  </section>;
}
