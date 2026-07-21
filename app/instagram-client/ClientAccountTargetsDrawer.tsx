"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, LockKeyhole, Plus, RefreshCw, Search, Sparkles, Trash2, Users, X } from "lucide-react";
import {
  buildTargetsOverview,
  isArchivedOrDeletedTarget,
  isPendingReviewTarget,
  isRejectedTarget,
  isValidEligibleTarget,
  safeTargetExportRows,
  targetHealthLabel,
  targetMatchesListFilter,
  targetPerformanceLabel,
  type TargetAccountItem,
  type TargetListFilter,
  type TargetSafeRow,
  type TargetsOverview,
} from "@/app/instagram-dashboard/targets-data";
import { targetFbrClientLabel } from "@/lib/instagram-dashboard/target-fbr-metrics";
import ClientAiTargetSearchWizard from "./ClientAiTargetSearchWizard";
import {
  clientAiTargetingButtonLabel,
  clientAiTargetingUpgradeLabel,
  isClientAiTargetingEnabled,
} from "@/lib/instagram-client/ai-targeting-gate";
import TargetAvatar from "./TargetAvatar";

type Lang = "fr" | "en";

export type DrawerCopy = {
  kicker: string;
  total: string;
  valid: string;
  archived: string;
  searchPh: string;
  chips: string[];
  refresh: string;
  export: string;
  del: string;
  addLbl: string;
  addPh: string;
  addBtn: string;
  bulkLbl: string;
  importBtn: string;
  aiLbl: string;
  cols: string[];
  elig: Record<string, string>;
  perf: { running: string; pending: string };
  found: string;
  notFound: string;
};

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  let payload: ApiEnvelope<T> | null = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as ApiEnvelope<T>;
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

function bulkUsernamesFromText(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^@+/, "").toLowerCase())
    .filter(Boolean);
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

function exportTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "").replace(/[:T]/g, "-");
}

function safeFilenamePart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "account";
}

function formatAddedDate(iso: string, lang: Lang) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || "—";
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en", { month: "short", day: "2-digit" }).format(date);
}

function fmtK(n: number | null, lang: Lang) {
  if (n == null) return "—";
  if (n >= 1000) {
    const v = n / 1000;
    return (v >= 10 ? Math.round(v) : v.toFixed(1)).toString().replace(".", ",") + (lang === "en" ? "K" : " k");
  }
  return n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US");
}

type DrawerElig = "eligible" | "verified" | "pending" | "rejected" | "archived";

function drawerEligKey(item: TargetAccountItem): DrawerElig {
  if (isArchivedOrDeletedTarget(item)) return "archived";
  if (isRejectedTarget(item)) return "rejected";
  if (isPendingReviewTarget(item)) return "pending";
  if (item.isVerified) return "verified";
  if (isValidEligibleTarget(item)) return "eligible";
  return "pending";
}

function clientFilterToAdmin(filter: string): TargetListFilter {
  if (filter === "eligible") return "active";
  if (filter === "pending") return "pending";
  if (filter === "rejected") return "rejected";
  if (filter === "archived") return "archived";
  return "all";
}

export type ClientAccountTargetsDrawerProps = {
  variant?: "dashboard" | "onboarding";
  open: boolean;
  onClose: () => void;
  lang: Lang;
  copy: DrawerCopy;
  accountId: string;
  accountUsername: string;
  packageCode: string;
  overview: TargetsOverview | null;
  onOverviewChange: (overview: TargetsOverview) => void;
  onReload: () => Promise<void>;
  aiInitialCriteria?: { niche?: string; location?: string };
};

export default function ClientAccountTargetsDrawer({
  variant = "dashboard",
  open,
  onClose,
  lang,
  copy: td,
  accountId,
  accountUsername,
  packageCode,
  overview,
  onOverviewChange,
  onReload,
  aiInitialCriteria,
}: ClientAccountTargetsDrawerProps) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [singleInput, setSingleInput] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const [aiWizardOpen, setAiWizardOpen] = useState(false);

  const filterKeys = ["all", "eligible", "pending", "rejected", "archived"];
  const aiEnabled = isClientAiTargetingEnabled(packageCode);
  const drawerTitle = `@${accountUsername.replace(/^@+/, "")}`;
  const packageLabel = packageCode.charAt(0).toUpperCase() + packageCode.slice(1);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await readApiResponse<TargetSafeRow[]>(
        await fetch(`/api/instagram-client/accounts/${encodeURIComponent(accountId)}/targets`, {
          headers: { Accept: "application/json" },
        }),
        lang === "fr" ? "Impossible de charger les cibles." : "Could not load targets.",
      );
      onOverviewChange(buildTargetsOverview(Array.isArray(data) ? data : []));
    } catch (e) {
      setError(e instanceof Error ? e.message : (lang === "fr" ? "Impossible de charger les cibles." : "Could not load targets."));
    } finally {
      setLoading(false);
    }
  }, [accountId, lang, onOverviewChange]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && open) onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setFilter("all");
    setQuery("");
    setSelected({});
    setSingleInput("");
    setBulkText("");
    setSuccess("");
    setError("");
    setAiMessage("");
    if (!overview) void loadTargets();
  }, [open, overview, loadTargets]);

  const rows = overview?.items ?? [];
  const counts = overview?.summary ?? { total: 0, validEligible: 0, archivedCount: 0 };
  const listFilter = clientFilterToAdmin(filter);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byStatus = rows.filter((r) => targetMatchesListFilter(r, listFilter));
    if (!q) return byStatus;
    return byStatus.filter(
      (r) =>
        r.targetUsername.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q) ||
        r.qualityLabel.toLowerCase().includes(q) ||
        r.verificationStatus.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q),
    );
  }, [rows, query, listFilter]);

  const nSelected = Object.entries(selected).filter(([, on]) => on).length;
  const canExport = open && rows.length > 0;
  const canRefresh = open && !loading && !saving;
  const canArchiveSelection = open && nSelected > 0 && !saving;
  const canSubmitAdd = open && !saving;

  const eligMap: Record<DrawerElig, { cls: string; label: string }> = {
    eligible: { cls: "cd-elig", label: td.elig.eligible },
    verified: { cls: "cd-ver", label: td.elig.verified },
    pending: { cls: "cd-pend", label: td.elig.pending },
    rejected: { cls: "cd-rej", label: td.elig.rejected },
    archived: { cls: "cd-arch", label: td.elig.archived },
  };

  async function refreshAll() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await loadTargets();
      await onReload();
      setSuccess(lang === "fr" ? "Liste actualisée." : "List refreshed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : (lang === "fr" ? "Actualisation impossible." : "Could not refresh."));
    } finally {
      setSaving(false);
    }
  }

  async function addSingle(event: FormEvent) {
    event.preventDefault();
    if (!singleInput.trim()) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await readApiResponse(
        await fetch(`/api/instagram-client/accounts/${encodeURIComponent(accountId)}/targets`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ target_username: singleInput }),
        }),
        lang === "fr" ? "Impossible d'ajouter la cible." : "Could not add target.",
      );
      setSingleInput("");
      setSuccess(lang === "fr" ? "Cible ajoutée." : "Target added.");
      await loadTargets();
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : (lang === "fr" ? "Impossible d'ajouter la cible." : "Could not add target."));
    } finally {
      setSaving(false);
    }
  }

  async function addBulk(event: FormEvent) {
    event.preventDefault();
    const usernames = bulkUsernamesFromText(bulkText);
    if (usernames.length === 0) {
      setError(lang === "fr" ? "Ajoutez un nom d'utilisateur par ligne." : "Add one username per line.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await readApiResponse<{ inserted?: number; summary?: { invalid?: number } }>(
        await fetch(`/api/instagram-client/accounts/${encodeURIComponent(accountId)}/targets`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ usernames }),
        }),
        lang === "fr" ? "Import groupé impossible." : "Could not bulk import.",
      );
      setBulkText("");
      setSuccess(
        lang === "fr"
          ? `${result.inserted ?? 0} cible(s) importée(s).`
          : `${result.inserted ?? 0} target(s) imported.`,
      );
      await loadTargets();
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : (lang === "fr" ? "Import groupé impossible." : "Could not bulk import."));
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const exportRows = safeTargetExportRows(rows);
    const header = ["target_username", "eligibility", "performance", "followers_count", "followback_ratio", "added_at"];
    const lines = [
      header.join(","),
      ...exportRows.map((r) =>
        [
          r.target_username,
          r.eligibility,
          r.performance,
          r.followers_count === null ? "—" : String(r.followers_count),
          r.followback_ratio === null ? "—" : String(r.followback_ratio),
          r.added_at,
        ].map(csvEscape).join(","),
      ),
    ];
    downloadUtf8File(`targets-${safeFilenamePart(accountUsername)}-${exportTimestamp()}.csv`, lines.join("\n"), "text/csv");
    setSuccess(lang === "fr" ? "Export CSV créé." : "CSV exported.");
  }

  async function archiveSelected() {
    const ids = Object.entries(selected).filter(([, on]) => on).map(([id]) => id);
    if (ids.length === 0) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await readApiResponse(
        await fetch(`/api/instagram-client/accounts/${encodeURIComponent(accountId)}/targets`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ids }),
        }),
        lang === "fr" ? "Archivage impossible." : "Could not archive.",
      );
      setSelected({});
      setSuccess(lang === "fr" ? (ids.length === 1 ? "Cible archivée." : `${ids.length} cibles archivées.`) : (ids.length === 1 ? "Target archived." : `${ids.length} targets archived.`));
      await loadTargets();
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : (lang === "fr" ? "Archivage impossible." : "Could not archive."));
    } finally {
      setSaving(false);
    }
  }

  async function restoreRow(id: string) {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await readApiResponse(
        await fetch(`/api/instagram-client/accounts/${encodeURIComponent(accountId)}/targets`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ id, action: "restore" }),
        }),
        lang === "fr" ? "Restauration impossible." : "Could not restore.",
      );
      setSuccess(lang === "fr" ? "Cible restaurée." : "Target restored.");
      await loadTargets();
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : (lang === "fr" ? "Restauration impossible." : "Could not restore."));
    } finally {
      setSaving(false);
    }
  }

  function handleAiClick() {
    if (!aiEnabled) return;
    setAiMessage("");
    setAiWizardOpen(true);
  }

  return (
    <>
      <div className={`cd-dwr-scrim${open ? " open" : ""}`} onClick={onClose} />
      <aside className={`cd-dwr${variant === "onboarding" ? " cd-dwr-onboarding" : ""}${open ? " open" : ""}`} aria-hidden={!open}>
        <header className="cd-dwr-hd">
          <div className="cd-dwr-hd-l">
            <span className="cd-dwr-hd-ic">
              <Users size={20} />
            </span>
            <div>
              <div className="cd-dwr-kicker">{td.kicker}</div>
              <div className="cd-dwr-title" style={{ color: "var(--accent)" }}>{drawerTitle}</div>
            </div>
          </div>
          <div className="cd-dwr-head-meta">
            <span className="cd-dwr-package">{packageLabel}</span>
            <span className={`cd-dwr-ai-badge${aiEnabled ? " active" : " locked"}`}><Sparkles size={13} />{aiEnabled ? (lang === "fr" ? "IA active" : "AI active") : (lang === "fr" ? "IA verrouillée" : "AI locked")}</span>
            <button type="button" className="cd-dwr-x" onClick={onClose} aria-label={lang === "fr" ? "Fermer" : "Close"}><X size={17} /></button>
          </div>
        </header>

        {open ? (
        <div className="cd-dwr-body">
          {(error || success) ? (
            <div style={{ marginBottom: 12, fontSize: 13 }}>
              {error ? <span style={{ color: "var(--bad)" }}>{error}</span> : null}
              {success ? <span style={{ color: "var(--good)" }}>{success}</span> : null}
            </div>
          ) : null}

          <div className="cd-dwr-stats">
            <div className="cd-dwr-stat"><div className="cd-dwr-stat-l">{td.total}</div><div className="cd-dwr-stat-v">{counts.total}</div></div>
            <div className="cd-dwr-stat"><div className="cd-dwr-stat-l">{td.valid}</div><div className="cd-dwr-stat-v" style={{ color: "var(--good)" }}>{counts.validEligible}</div></div>
            <div className="cd-dwr-stat"><div className="cd-dwr-stat-l">{td.archived}</div><div className="cd-dwr-stat-v" style={{ color: "var(--ink-dim)" }}>{counts.archivedCount}</div></div>
          </div>

          <div className="cd-dwr-controls">
            <div className="cd-dwr-search">
              <Search size={15} />
              <input type="text" placeholder={td.searchPh} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="cd-dwr-chips">
              {filterKeys.map((k, i) => (
                <button key={k} type="button" className={`cd-dwr-chip${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>{td.chips[i]}</button>
              ))}
            </div>
          </div>

          <div className="cd-dwr-actions">
            <button type="button" className="cd-dwr-act" onClick={() => void refreshAll()} disabled={!canRefresh}>
              <RefreshCw size={14} />
              {td.refresh}
            </button>
            <button type="button" className="cd-dwr-act" onClick={exportCsv} disabled={!canExport}>
              <Download size={14} />
              {td.export}
            </button>
            <button type="button" className="cd-dwr-act" style={{ color: "var(--bad)" }} disabled={!canArchiveSelection} onClick={() => void archiveSelected()}>
              <Trash2 size={14} />
              {td.del}
            </button>
          </div>

          <div className="cd-dwr-add">
            <form className="cd-dwr-add-card" onSubmit={addSingle}>
              <div className="cd-dwr-add-lbl">{td.addLbl}</div>
              <div className="cd-dwr-add-row">
                <input type="text" className="cd-dwr-in" placeholder={td.addPh} value={singleInput} onChange={(e) => setSingleInput(e.target.value)} />
                <button type="submit" className="cd-dwr-add-btn" disabled={!canSubmitAdd}>
                  <Plus size={14} />
                  {td.addBtn}
                </button>
              </div>
            </form>
            <form className="cd-dwr-add-card" onSubmit={addBulk}>
              <div className="cd-dwr-add-lbl">{td.bulkLbl}</div>
              <textarea className="cd-dwr-ta" placeholder={"user_one\n@user_two\nuser_three"} value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
              <button type="submit" className="cd-dwr-import" disabled={!canSubmitAdd}>{td.importBtn}</button>
            </form>
          </div>

          <div className={`cd-dwr-add-card cd-dwr-ai-card${aiEnabled ? " active" : " locked"}`}>
            <span className="cd-dwr-ai-icon">{aiEnabled ? <Sparkles size={20} /> : <LockKeyhole size={20} />}</span>
            <div className="cd-dwr-ai-copy"><div className="cd-dwr-add-lbl">{td.aiLbl}</div><p>{aiEnabled ? (lang === "fr" ? "Recherche guidée par ton analyse publique et tes critères confirmés." : "Search guided by your public analysis and confirmed criteria.") : (lang === "fr" ? "Disponible avec Pro et Premium. Les ajouts manuels restent accessibles." : "Available with Pro and Premium. Manual additions remain available.")}</p></div>
            {aiEnabled ? (
              <>
                <button type="button" className="cd-dwr-import" onClick={handleAiClick}>{clientAiTargetingButtonLabel(lang)}</button>
                {aiMessage ? <p style={{ marginTop: 10, fontSize: 12, color: "var(--ink-mute)" }}>{aiMessage}</p> : null}
              </>
            ) : (
              <button type="button" className="cd-dwr-import cd-dwr-import-upgrade" disabled aria-disabled="true">
                {clientAiTargetingUpgradeLabel(lang)}
              </button>
            )}
          </div>

          <div className="cd-dwr-table">
            <div className="cd-dwr-trow cd-dwr-thead">
              {td.cols.map((c, i) => <span key={i} className={i >= 4 && i <= 7 ? "cd-dwr-num" : ""}>{c}</span>)}
            </div>
            <div>
              {loading ? (
                <div className="cd-dwr-empty">{lang === "fr" ? "Chargement…" : "Loading…"}</div>
              ) : filteredRows.length === 0 ? (
                <div className="cd-dwr-empty">{lang === "en" ? "No targets match your filter." : "Aucune cible ne correspond à votre filtre."}</div>
              ) : filteredRows.map((r) => {
                const elig = drawerEligKey(r);
                const e = eligMap[elig];
                const foll = fmtK(r.followersCount, lang);
                const verTxt = r.verificationStatus === "found" ? td.found : td.notFound;
                const fbr = targetFbrClientLabel(r.fbrPercent, r.followsSent, r.fbrMetricsReliable, lang);
                const perfLabel = targetPerformanceLabel(r.performanceStatus);
                const perfTxt = r.performanceStatus === "pending" || r.performanceStatus === "insufficient_data"
                  ? td.perf.pending
                  : perfLabel !== "—" ? perfLabel : null;
                const addedDisplay = formatAddedDate(r.createdAt, lang);
                const srcDisplay = r.sourceLabel;
                const isSelected = !!selected[r.id];
                const isArchived = isArchivedOrDeletedTarget(r);
                return (
                  <div key={r.id} className="cd-dwr-trow cd-dwr-rrow">
                    <span
                      className={`cd-dwr-cb${isSelected ? " on" : ""}`}
                      onClick={() => setSelected((s) => ({ ...s, [r.id]: !s[r.id] }))}
                      role="checkbox"
                      aria-checked={isSelected}
                    />
                    <div className="cd-dwr-u">
                      <TargetAvatar
                        accountId={accountId}
                        targetId={r.id}
                        username={r.targetUsername}
                        avatarUrl={r.avatarUrl}
                        avatarAvailable={r.avatarAvailable}
                        size={28}
                      />
                      <span className="cd-dwr-u-h">@{r.targetUsername}</span>
                    </div>
                    <span className={`cd-dwr-ver${r.verificationStatus === "not_found" ? " cd-nf" : ""}`}>{verTxt}</span>
                    <span><span className={`cd-dwr-pill ${e.cls}`}>{targetHealthLabel(r.qualityStatus)}</span></span>
                    <span className="cd-dwr-num">{foll}</span>
                    <span>{perfTxt ? <span className="cd-dwr-tag">{perfTxt}</span> : <span className="cd-dwr-dash">—</span>}</span>
                    <span className="cd-dwr-num">{fbr}</span>
                    <span className="cd-dwr-num">{r.followsSent ?? 0}</span>
                    <span><span className="cd-dwr-last">{r.lastUsedAt ? formatAddedDate(r.lastUsedAt, lang) : "—"}</span></span>
                    <span>
                      <span className="cd-dwr-added">{addedDisplay}</span>
                      <span className="cd-dwr-added-s">{srcDisplay}</span>
                      {isArchived ? (
                        <button type="button" className="cd-dwr-act" style={{ marginTop: 4, fontSize: 11 }} onClick={() => void restoreRow(r.id)}>
                          {lang === "fr" ? "Restaurer" : "Restore"}
                        </button>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        ) : null}
      </aside>
      <ClientAiTargetSearchWizard
        open={aiWizardOpen}
        onClose={() => setAiWizardOpen(false)}
        lang={lang}
        accountId={accountId}
        initialCriteria={aiInitialCriteria}
        onValidated={async (message) => {
          setSuccess(message);
          await loadTargets();
          await onReload();
        }}
      />
      <style jsx global>{`
        .cd-dwr-onboarding{--bg:#080b1b;--surface:#11172a;--surface-2:#0c1123;--line:#2a3350;--line-2:#202943;--ink:#f7f8fc;--ink-dim:#bdc6d9;--ink-mute:#7f8aa5;--accent:#d95cff;--accent-2:#9656f2;--a-soft:rgba(217,92,255,.1);--a-ring:rgba(217,92,255,.42);--a-tint:rgba(217,92,255,.05);--good:#4ee2a0;--bad:#ff7c87;--bad-line:rgba(255,124,135,.42);--r:8px;--r-sm:6px;--tr:.18s;width:min(1160px,96vw);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg)}
        .cd-dwr-onboarding::before{content:"";height:3px;position:absolute;top:0;left:0;right:0;z-index:2;background:linear-gradient(90deg,#d95cff,#ee70a6 46%,#ff9d57)}
        .cd-dwr-onboarding .cd-dwr-hd{padding-top:24px;background:rgba(9,13,30,.97)}
        .cd-dwr-onboarding .cd-dwr-hd-ic{border-radius:8px;background:linear-gradient(145deg,rgba(217,92,255,.2),rgba(255,157,87,.1))}
        .cd-dwr-onboarding .cd-dwr-title{font-size:1.28rem;letter-spacing:0}
        .cd-dwr-head-meta{display:flex;align-items:center;gap:8px}
        .cd-dwr-package,.cd-dwr-ai-badge{display:inline-flex;align-items:center;gap:5px;padding:6px 9px;border:1px solid var(--line);border-radius:6px;color:var(--ink-dim);background:var(--surface);font-size:.7rem;font-weight:800}
        .cd-dwr-ai-badge.active{color:#7ff2b9;border-color:rgba(78,226,160,.35);background:rgba(78,226,160,.08)}
        .cd-dwr-ai-badge.locked{color:#ffc478;border-color:rgba(255,157,87,.32);background:rgba(255,157,87,.08)}
        .cd-dwr-onboarding .cd-dwr-body{background:radial-gradient(circle at 84% 2%,rgba(154,78,222,.08),transparent 31%),var(--bg)}
        .cd-dwr-onboarding .cd-dwr-stat{background:linear-gradient(180deg,#151d34,#10162a)}
        .cd-dwr-onboarding .cd-dwr-stat-v{color:var(--ink)}
        .cd-dwr-onboarding .cd-dwr-add-card{background:linear-gradient(180deg,#141c33,#10162a)}
        .cd-dwr-onboarding .cd-dwr-ai-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px;padding:18px;border-color:rgba(217,92,255,.28)}
        .cd-dwr-onboarding .cd-dwr-ai-card.locked{border-color:rgba(255,157,87,.28)}
        .cd-dwr-onboarding .cd-dwr-ai-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:8px;color:#ed90f4;background:rgba(217,92,255,.12);border:1px solid rgba(217,92,255,.28)}
        .cd-dwr-onboarding .cd-dwr-ai-card.locked .cd-dwr-ai-icon{color:#ffc478;background:rgba(255,157,87,.08);border-color:rgba(255,157,87,.26)}
        .cd-dwr-onboarding .cd-dwr-ai-copy .cd-dwr-add-lbl{margin:0;color:#e8d8f0}
        .cd-dwr-onboarding .cd-dwr-ai-copy p{margin:6px 0 0;color:var(--ink-mute);font-size:.78rem;line-height:1.45}
        .cd-dwr-onboarding .cd-dwr-ai-card .cd-dwr-import{width:auto;min-width:210px;margin:0;padding:11px 16px}
        .cd-dwr-onboarding .cd-dwr-import-upgrade{background:#252034!important;color:#ffc478!important;border:1px solid rgba(255,157,87,.26)!important}
        .cd-dwr-onboarding .cd-dwr-table{background:#0f1528}
        .cd-dwr-onboarding .cd-dwr-rrow:hover{background:rgba(217,92,255,.06)}
        .cd-dwr-onboarding button:focus-visible,.cd-dwr-onboarding input:focus-visible,.cd-dwr-onboarding textarea:focus-visible{outline:2px solid #df6fda;outline-offset:2px}
        @media(max-width:760px){.cd-dwr-onboarding{width:100vw}.cd-dwr-package,.cd-dwr-ai-badge{display:none}.cd-dwr-onboarding .cd-dwr-hd{padding:18px}.cd-dwr-onboarding .cd-dwr-body{padding:17px}.cd-dwr-onboarding .cd-dwr-ai-card{grid-template-columns:auto 1fr}.cd-dwr-onboarding .cd-dwr-ai-card .cd-dwr-import{grid-column:1/-1;width:100%;min-width:0}.cd-dwr-head-meta{gap:4px}}
      `}</style>
    </>
  );
}

export function buildInitialTargetsOverview(rows: TargetSafeRow[]) {
  return buildTargetsOverview(rows);
}

export function mainTargetingItems(overview: TargetsOverview | null) {
  if (!overview) return [];
  return overview.items
    .filter((item) => !isArchivedOrDeletedTarget(item))
    .map((item) => ({
      id: item.id,
      targetUsername: item.targetUsername,
      avatarUrl: item.avatarUrl,
      avatarAvailable: item.avatarAvailable,
    }));
}

export function mainTargetingUsernames(overview: TargetsOverview | null) {
  return mainTargetingItems(overview).map((item) => item.targetUsername);
}
