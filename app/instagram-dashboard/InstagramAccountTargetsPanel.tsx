"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Plus, RefreshCw, RotateCcw, Search, Trash2, Users, X } from "lucide-react";
import {
  buildTargetsOverview,
  safeTargetExportRows,
  targetHealthHelper,
  targetHealthLabel,
  type TargetQualityStatus,
  type TargetSafeRow,
  type TargetsOverview,
} from "./targets-data";

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

type InstagramAccountTargetsPanelProps = {
  accountId: string;
  accountUsername: string;
  open: boolean;
  onClose: () => void;
};

async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  let payload: ApiEnvelope<T> | null = null;
  const trimmed = text.trim();

  if (trimmed.includes("NEXT_REDIRECT")) {
    throw new Error("Authentication required. Please sign in again.");
  }

  if (trimmed) {
    try {
      payload = JSON.parse(trimmed) as ApiEnvelope<T>;
    } catch {
      throw new Error(response.ok ? fallback : `Request failed (${response.status}).`);
    }
  }

  if (!payload || typeof payload !== "object" || !("ok" in payload)) {
    throw new Error(response.ok ? fallback : `Request failed (${response.status}).`);
  }

  if (payload.ok) return payload.data;
  throw new Error(payload.error || fallback);
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || "—";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function healthBadgeClass(status: TargetQualityStatus) {
  if (status === "poor") return "border-red-400/35 bg-red-400/12 text-red-200";
  if (status === "monitor") return "border-amber-400/35 bg-amber-400/15 text-amber-200";
  if (status === "good") return "border-emerald-400/35 bg-emerald-400/12 text-emerald-200";
  return "border-slate-400/25 bg-slate-400/10 text-slate-300";
}

function healthDotClass(status: TargetQualityStatus) {
  if (status === "poor") return "bg-red-400";
  if (status === "monitor") return "bg-amber-400";
  if (status === "good") return "bg-emerald-400";
  return "bg-slate-500";
}

function HealthBadge({ status }: { status: TargetQualityStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${healthBadgeClass(status)}`}
      title={targetHealthHelper(status)}
    >
      <span className={`size-1.5 rounded-full ${healthDotClass(status)}`} aria-hidden />
      {targetHealthLabel(status)}
    </span>
  );
}

function exportTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "").replace(/[:T]/g, "-");
}

function safeFilenamePart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "account";
}

function downloadUtf8File(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function metricText(value: number | null, suffix = "") {
  if (value === null) return "pending source";
  return `${new Intl.NumberFormat("en").format(value)}${suffix}`;
}

function emptyOverview(): TargetsOverview {
  return buildTargetsOverview([]);
}

function EmptyTargetsState({ hasRows }: { hasRows: boolean }) {
  return (
    <div className="grid min-h-[180px] place-items-center rounded-xl border border-white/8 bg-white/[0.02] px-4 py-8 text-center">
      <div className="max-w-sm">
        <span className="block text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">
          {hasRows ? "Empty filter" : "Empty state"}
        </span>
        <strong className="mt-2 block text-base font-extrabold text-slate-100">
          {hasRows ? "No targets match this filter" : "No target accounts yet"}
        </strong>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          {hasRows
            ? "Clear filters or refresh."
            : "Add usernames manually or bulk import one per line."}
        </p>
      </div>
    </div>
  );
}

function PendingSourcePanel({ overview }: { overview: TargetsOverview }) {
  const pendingCards = [
    {
      title: "Source quality metrics pending",
      text: "Follower validation, FBR, follows sent, followbacks, follower counts, and poor-performance detection will appear after a real Instagram validation source is connected.",
      meta: `Quality pending: ${overview.summary.qualityPending}`,
    },
    {
      title: "Cross-surface sync pending",
      text: "Future CT changes must sync across backend DB, admin dashboard, client dashboard, BotApp and Mac app.",
      meta: `Sync pending: ${overview.summary.syncPendingCount}`,
    },
    {
      title: "Archive/delete model pending",
      text: "Archive will preserve history; delete will require audited backend support unless hard-delete remains explicitly approved.",
      meta: `Archive/delete: ${overview.sourceStatus.archiveDeleteModel}`,
    },
  ];

  return (
    <div className="grid shrink-0 gap-2.5 px-5 md:grid-cols-3">
      {pendingCards.map((card) => (
        <article key={card.title} className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
          <span className="block text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">
            Pending source
          </span>
          <strong className="mt-1.5 block text-sm font-extrabold text-slate-100">{card.title}</strong>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{card.text}</p>
          <small className="mt-2 block text-[11px] font-bold text-slate-500">{card.meta}</small>
        </article>
      ))}
    </div>
  );
}

export default function InstagramAccountTargetsPanel({
  accountId,
  accountUsername,
  open,
  onClose,
}: InstagramAccountTargetsPanelProps) {
  const [overview, setOverview] = useState<TargetsOverview>(() => emptyOverview());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [filter, setFilter] = useState("");
  const [singleUsername, setSingleUsername] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    danger?: boolean;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await readApiResponse<TargetSafeRow[]>(
        await fetch(`/api/instagram-dashboard/targets?account_id=${encodeURIComponent(accountId)}`, {
          headers: { Accept: "application/json" },
        }),
        "Could not load targets.",
      );
      setOverview(buildTargetsOverview(Array.isArray(data) ? data : []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load targets.");
      setOverview(emptyOverview());
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (open) {
      void loadTargets();
      setFilter("");
      setSingleUsername("");
      setBulkText("");
      setSelected(new Set());
      setSuccess("");
      setError("");
    }
  }, [open, loadTargets]);

  const rows = overview.items;
  const counts = overview.summary;

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.targetUsername.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q) ||
        r.statusLabel.toLowerCase().includes(q) ||
        r.sourceLabel.toLowerCase().includes(q),
    );
  }, [rows, filter]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    const visibleIds = filteredRows.map((r) => r.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
    setSelected(() => {
      if (allSelected) return new Set();
      return new Set(visibleIds);
    });
  }

  async function addSingle(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await readApiResponse<{ validation_pending?: boolean }>(
        await fetch("/api/instagram-dashboard/targets", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ account_id: accountId, target_username: singleUsername }),
        }),
        "Could not add target.",
      );
      setSingleUsername("");
      setSuccess(
        result.validation_pending
          ? "Target added. Follower validation pending source. This CT has not been validated against the 500-50,000 followers rule yet."
          : "Target added.",
      );
      await loadTargets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add target.");
    } finally {
      setSaving(false);
    }
  }

  async function addBulk(event: FormEvent) {
    event.preventDefault();
    const lines = bulkText.split(/\r?\n/);
    const usernames = lines.map((l) => l.trim().replace(/^@+/, "").toLowerCase()).filter(Boolean);

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await readApiResponse<{
        inserted: number;
        skipped_duplicates: number;
        skipped_deleted?: number;
        skipped_invalid?: number;
        validation_pending?: number;
      }>(
        await fetch("/api/instagram-dashboard/targets", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ account_id: accountId, usernames }),
        }),
        "Could not bulk import targets.",
      );
      setBulkText("");
      setSuccess(
        [
          `Imported ${result.inserted} target(s).`,
          `Skipped duplicates: ${result.skipped_duplicates}.`,
          result.skipped_deleted ? `Previously deleted blocked: ${result.skipped_deleted}.` : "",
          result.skipped_invalid ? `Invalid usernames blocked: ${result.skipped_invalid}.` : "",
          result.validation_pending
            ? `Follower validation pending source: ${result.validation_pending}. These CTs have not been validated against the 500-50,000 followers rule yet.`
            : "",
        ].filter(Boolean).join(" "),
      );
      await loadTargets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not bulk import.");
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const exportRows = safeTargetExportRows(rows);
    const header = ["target_username", "health", "followers_count", "followback_ratio", "added_at"];
    const lines = [
      header.join(","),
      ...exportRows.map((r) =>
        [
          r.target_username,
          r.health,
          r.followers_count === null ? "pending source" : String(r.followers_count),
          r.followback_ratio === null ? "pending source" : String(r.followback_ratio),
          r.added_at,
        ].map(csvEscape).join(","),
      ),
    ];
    const filename = `targets-${safeFilenamePart(accountUsername)}-${exportTimestamp()}.csv`;
    downloadUtf8File(filename, lines.join("\n"), "text/csv");
    setSuccess("CSV exported.");
    setExportOpen(false);
  }

  function exportJson() {
    const exportRows = safeTargetExportRows(rows);
    const filename = `targets-${safeFilenamePart(accountUsername)}-${exportTimestamp()}.json`;
    downloadUtf8File(filename, JSON.stringify(exportRows, null, 2), "application/json");
    setSuccess("Safe JSON export created.");
    setExportOpen(false);
  }

  async function deleteIds(ids: string[]) {
    if (ids.length === 0) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await readApiResponse(
        await fetch("/api/instagram-dashboard/targets", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ account_id: accountId, ids }),
        }),
        "Could not delete targets.",
      );
      setSelected(new Set());
      setSuccess(ids.length === 1 ? "Target deleted." : `${ids.length} targets deleted.`);
      await loadTargets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  }

  async function resetIds(ids: string[]) {
    if (ids.length === 0) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await readApiResponse(
        await fetch("/api/instagram-dashboard/targets/reset", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ account_id: accountId, ids }),
        }),
        "Could not reset targets.",
      );
      setSuccess(ids.length === 1 ? "Target reset to pending." : `${ids.length} targets reset.`);
      await loadTargets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset.");
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  }

  if (!open) return null;

  const titleId = `ig-targets-title-${accountId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <>
      <div
        className="fixed inset-0 z-[120] flex justify-center overflow-y-auto bg-slate-950/75 px-4 py-6 backdrop-blur-sm"
        role="presentation"
        onMouseDown={onClose}
      >
        <aside
          className="my-auto flex max-h-[min(92vh,900px)] min-h-0 w-full max-w-[920px] flex-col gap-3.5 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-950 shadow-[0_28px_80px_rgba(0,0,0,0.45)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header className="shrink-0 flex items-start justify-between gap-3 px-5 pt-5">
            <div className="flex items-center gap-3 text-slate-100">
              <Users className="shrink-0 text-slate-300" size={22} aria-hidden />
              <div>
                <span className="block text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">
                  Targets
                </span>
                <h2 id={titleId} className="mt-1 text-xl font-extrabold tracking-tight text-slate-50">
                  @{accountUsername}
                </h2>
              </div>
            </div>
            <button
              type="button"
              className="grid size-[38px] place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:text-white"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </header>

          <div className="grid shrink-0 grid-cols-1 gap-2.5 px-5 sm:grid-cols-3">
            {[
              { label: "Total", value: counts.total, color: "text-slate-50" },
              { label: "Deleted", value: counts.deletedCount, color: "text-red-300" },
              { label: "Archived", value: counts.archivedCount, color: "text-sky-300" },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5"
              >
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {c.label}
                </span>
                <strong className={`mt-1.5 block text-xl font-extrabold ${c.color}`}>{c.value}</strong>
              </div>
            ))}
          </div>

          <div className="shrink-0 flex flex-wrap items-center gap-2.5 px-5">
            <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-slate-400">
              <Search size={14} aria-hidden />
              <input
                type="search"
                placeholder="Filter by username, health, status…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-50 outline-none placeholder:text-slate-500"
                aria-label="Filter targets"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-xs font-extrabold text-slate-200 hover:bg-white/10 disabled:opacity-45"
                onClick={() => void loadTargets()}
                disabled={loading || saving}
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden />
                Refresh
              </button>
              <div className="relative">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-xs font-extrabold text-slate-200 hover:bg-white/10 disabled:opacity-45"
                  onClick={() => setExportOpen((v) => !v)}
                  disabled={rows.length === 0 || saving}
                >
                  <Download size={14} aria-hidden />
                  Export
                </button>
                {exportOpen ? (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-10 min-w-[120px] overflow-hidden rounded-lg border border-white/10 bg-slate-900 shadow-xl">
                    <button
                      type="button"
                      className="block w-full px-3.5 py-2.5 text-left text-xs font-bold text-slate-200 hover:bg-white/6"
                      onClick={exportCsv}
                    >
                      CSV
                    </button>
                    <button
                      type="button"
                      className="block w-full px-3.5 py-2.5 text-left text-xs font-bold text-slate-200 hover:bg-white/6"
                      onClick={exportJson}
                    >
                      JSON
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/35 bg-red-950/40 px-3 py-2 text-xs font-extrabold text-red-200 hover:bg-red-950/60 disabled:opacity-45"
                disabled={selected.size === 0 || saving}
                onClick={() =>
                  setConfirm({
                    title: "Delete selected targets?",
                    description: `${selected.size} target(s) will be removed from ig_targets for this account. Archive mode with audit and cross-surface sync is planned, but not active yet.`,
                    danger: true,
                    onConfirm: () => void deleteIds([...selected]),
                  })
                }
              >
                <Trash2 size={14} aria-hidden />
                Delete selected
              </button>
            </div>
          </div>

          {(error || success) && (
            <div
              className={
                error
                  ? "mx-5 rounded-lg border border-red-400/35 bg-red-400/10 px-3 py-2.5 text-sm font-semibold text-red-200"
                  : "mx-5 rounded-lg border border-emerald-400/35 bg-emerald-400/10 px-3 py-2.5 text-sm font-semibold text-emerald-200"
              }
            >
              {error || success}
            </div>
          )}

          <PendingSourcePanel overview={overview} />

          <div className="grid shrink-0 gap-3 px-5 md:grid-cols-2">
            <form
              onSubmit={addSingle}
              className="flex flex-col gap-2.5 rounded-xl border border-white/8 bg-white/[0.02] p-3.5"
            >
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Add target</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Instagram username"
                  value={singleUsername}
                  onChange={(e) => setSingleUsername(e.target.value)}
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/55 px-3 py-2.5 text-sm text-slate-50 outline-none placeholder:text-slate-500"
                />
                <button
                  type="submit"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-400/40 bg-amber-500/18 px-3 py-2 text-xs font-extrabold text-amber-100 hover:bg-amber-500/28 disabled:opacity-45"
                  disabled={saving || !singleUsername.trim()}
                >
                  <Plus size={14} aria-hidden />
                  Add
                </button>
              </div>
            </form>
            <form
              onSubmit={addBulk}
              className="flex flex-col gap-2.5 rounded-xl border border-white/8 bg-white/[0.02] p-3.5"
            >
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                Bulk add (one per line)
              </h3>
              <textarea
                rows={4}
                placeholder={"user_one\n@user_two\nuser_three"}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                className="resize-y rounded-lg border border-white/10 bg-slate-950/55 px-3 py-2.5 font-mono text-sm text-slate-50 outline-none placeholder:text-slate-500"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-amber-400/40 bg-amber-500/18 px-3 py-2 text-xs font-extrabold text-amber-100 hover:bg-amber-500/28 disabled:opacity-45"
                disabled={saving || !bulkText.trim()}
              >
                Import
              </button>
            </form>
          </div>

          <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-5 pb-5">
            {loading ? (
              <p className="py-10 text-center text-sm text-slate-400">Loading targets…</p>
            ) : filteredRows.length === 0 ? (
              <EmptyTargetsState hasRows={rows.length > 0} />
            ) : (
              <table className="min-w-[820px] w-full border-separate border-spacing-y-1.5 text-sm">
                <thead>
                  <tr>
                    <th className="sticky top-0 z-[1] w-10 bg-slate-950/95 px-2 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                      <input
                        type="checkbox"
                        checked={
                          filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.id))
                        }
                        onChange={toggleSelectAllVisible}
                        aria-label="Select all visible"
                        className="accent-emerald-500"
                      />
                    </th>
                    <th className="sticky top-0 z-[1] bg-slate-950/95 px-2 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                      Username
                    </th>
                    <th className="sticky top-0 z-[1] bg-slate-950/95 px-2 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                      Health
                    </th>
                    <th className="sticky top-0 z-[1] bg-slate-950/95 px-2 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                      Followers
                    </th>
                    <th className="sticky top-0 z-[1] bg-slate-950/95 px-2 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                      Followback ratio
                    </th>
                    <th className="sticky top-0 z-[1] bg-slate-950/95 px-2 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                      Added at
                    </th>
                    <th className="sticky top-0 z-[1] bg-slate-950/95 px-2 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td className="rounded-l-lg border-y border-l border-white/6 bg-white/[0.03] px-2 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggleSelect(row.id)}
                          aria-label={`Select ${row.targetUsername}`}
                          className="accent-emerald-500"
                        />
                      </td>
                      <td className="border-y border-white/6 bg-white/[0.03] px-2 py-2.5">
                        <strong className="font-extrabold text-slate-100">@{row.targetUsername}</strong>
                      </td>
                      <td className="border-y border-white/6 bg-white/[0.03] px-2 py-2.5">
                        <HealthBadge status={row.healthStatus} />
                      </td>
                      <td className="border-y border-white/6 bg-white/[0.03] px-2 py-2.5 text-slate-400">
                        {metricText(row.followersCount)}
                      </td>
                      <td className="border-y border-white/6 bg-white/[0.03] px-2 py-2.5 text-slate-400">
                        {metricText(row.fbrPercent, "%")}
                      </td>
                      <td className="border-y border-white/6 bg-white/[0.03] px-2 py-2.5 text-slate-400">
                        {formatWhen(row.createdAt)}
                      </td>
                      <td className="rounded-r-lg border-y border-r border-white/6 bg-white/[0.03] px-2 py-2.5">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-white/5 px-2 py-1 text-[11px] font-bold text-slate-200 hover:bg-white/10 disabled:opacity-45"
                            disabled={saving}
                            onClick={() =>
                              setConfirm({
                                title: "Reset target to pending?",
                                description: `@${row.targetUsername} will be set back to pending.`,
                                onConfirm: () => void resetIds([row.id]),
                              })
                            }
                          >
                            <RotateCcw size={12} aria-hidden />
                            Reset
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-red-400/35 bg-red-950/30 px-2 py-1 text-[11px] font-bold text-red-200 hover:bg-red-950/50 disabled:opacity-45"
                            disabled={saving}
                            onClick={() =>
                              setConfirm({
                                title: "Delete this target?",
                                description: `@${row.targetUsername} will be removed from ig_targets. Archive mode with audit and cross-surface sync is planned, but not active yet.`,
                                danger: true,
                                onConfirm: () => void deleteIds([row.id]),
                              })
                            }
                          >
                            <Trash2 size={12} aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </aside>
      </div>

      {confirm ? (
        <div
          className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/55 p-4"
          role="presentation"
          onMouseDown={() => !saving && setConfirm(null)}
        >
          <section
            className="w-full max-w-md rounded-2xl border border-white/12 bg-slate-900 p-5 text-slate-100 shadow-xl"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-extrabold">{confirm.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{confirm.description}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-xs font-extrabold text-slate-200 hover:bg-white/10 disabled:opacity-45"
                disabled={saving}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={
                  confirm.danger
                    ? "rounded-lg border border-red-400/40 bg-red-950/50 px-3 py-2 text-xs font-extrabold text-red-100 hover:bg-red-950/70 disabled:opacity-45"
                    : "rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-3 py-2 text-xs font-extrabold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-45"
                }
                disabled={saving}
                onClick={() => void confirm.onConfirm()}
              >
                {saving ? "…" : "Confirm"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
