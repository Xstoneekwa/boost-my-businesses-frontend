"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClientActivityItem } from "@/lib/instagram-client/client-activity-log";

type Lang = "fr" | "en";
type Period = "7d" | "30d" | "90d";

type ActivityCopy = {
  title: string;
  subtitle: string;
  searchPh: string;
  periodLabel: string;
  actionLabel: string;
  resultLabel: string;
  loadMore: string;
  emptyTitle: string;
  emptyBody: string;
  errorBody: string;
  loading: string;
  columns: {
    date: string;
    instagram: string;
    target: string;
    action: string;
    result: string;
    detail: string;
    touched: string;
  };
  periods: Record<Period, string>;
  actions: Array<{ value: string; label: string }>;
  results: Array<{ value: string; label: string }>;
};

const COPY: Record<Lang, ActivityCopy> = {
  fr: {
    title: "Activité",
    subtitle: "Suivez les actions réalisées sur votre campagne : comptes cibles, comptes touchés et résultats.",
    searchPh: "Rechercher un compte, une action ou un résultat…",
    periodLabel: "Période",
    actionLabel: "Action",
    resultLabel: "Résultat",
    loadMore: "Charger plus",
    emptyTitle: "Aucune activité pour le moment",
    emptyBody: "Les actions sur vos comptes cibles apparaîtront ici dès qu'elles seront disponibles.",
    errorBody: "Impossible d'afficher l'activité pour le moment. Réessayez dans quelques instants.",
    loading: "Chargement de l'activité…",
    columns: {
      date: "Date",
      instagram: "Compte Instagram",
      target: "Compte cible",
      action: "Action",
      result: "Résultat",
      detail: "Détail",
      touched: "Compte touché",
    },
    periods: { "7d": "7 jours", "30d": "30 jours", "90d": "90 jours" },
    actions: [
      { value: "all", label: "Toutes les actions" },
      { value: "follow_sent", label: "Compte suivi" },
      { value: "post_like_success", label: "Publication aimée" },
      { value: "story_viewed", label: "Story consultée" },
      { value: "dm_sent", label: "Message envoyé" },
      { value: "target_add_single", label: "Compte cible ajouté" },
      { value: "target_archive", label: "Compte cible retiré" },
      { value: "mute_success", label: "Compte mis en sourdine" },
    ],
    results: [
      { value: "all", label: "Tous les résultats" },
      { value: "success", label: "Réussi" },
      { value: "skipped", label: "Non effectué" },
      { value: "failed", label: "Échec" },
      { value: "pending", label: "En attente" },
    ],
  },
  en: {
    title: "Activity",
    subtitle: "Track actions on your campaign: target accounts, touched accounts, and outcomes.",
    searchPh: "Search account, action, or result…",
    periodLabel: "Period",
    actionLabel: "Action",
    resultLabel: "Result",
    loadMore: "Load more",
    emptyTitle: "No activity yet",
    emptyBody: "Actions on your target accounts will appear here as soon as they are available.",
    errorBody: "Activity cannot be displayed right now. Please try again shortly.",
    loading: "Loading activity…",
    columns: {
      date: "Date",
      instagram: "Instagram account",
      target: "Target account",
      action: "Action",
      result: "Result",
      detail: "Detail",
      touched: "Touched account",
    },
    periods: { "7d": "7 days", "30d": "30 days", "90d": "90 days" },
    actions: [
      { value: "all", label: "All actions" },
      { value: "follow_sent", label: "Account followed" },
      { value: "post_like_success", label: "Post liked" },
      { value: "story_viewed", label: "Story viewed" },
      { value: "dm_sent", label: "Message sent" },
      { value: "target_add_single", label: "Target account added" },
      { value: "target_archive", label: "Target account removed" },
      { value: "mute_success", label: "Account muted" },
    ],
    results: [
      { value: "all", label: "All results" },
      { value: "success", label: "Successful" },
      { value: "skipped", label: "Not performed" },
      { value: "failed", label: "Failed" },
      { value: "pending", label: "Pending" },
    ],
  },
};

function formatActivityDate(value: string | null, lang: Lang) {
  if (!value) return lang === "fr" ? "—" : "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resultClass(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("réussi") || normalized.includes("successful")) return "cd-act-result-success";
  if (normalized.includes("non effectué") || normalized.includes("not performed")) return "cd-act-result-skipped";
  if (normalized.includes("échec") || normalized.includes("failed")) return "cd-act-result-failed";
  if (normalized.includes("attente") || normalized.includes("pending")) return "cd-act-result-pending";
  return "";
}

export default function ClientActivityPanel({
  accountId,
  lang,
  enabled,
}: {
  accountId: string | null;
  lang: Lang;
  enabled: boolean;
}) {
  const copy = COPY[lang];
  const [items, setItems] = useState<ClientActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<Period>("30d");
  const [action, setAction] = useState("all");
  const [result, setResult] = useState("all");

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      lang,
      period,
      limit: "50",
    });
    if (search.trim()) params.set("search", search.trim());
    if (action !== "all") params.set("action", action);
    if (result !== "all") params.set("result", result);
    return params.toString();
  }, [action, lang, period, result, search]);

  const loadActivity = useCallback(async (cursor?: string | null, append = false) => {
    if (!accountId || !enabled) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(queryString);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/instagram-client/accounts/${encodeURIComponent(accountId)}/activity?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        data?: { items?: ClientActivityItem[]; nextCursor?: string | null };
      };
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error || copy.errorBody);
      }
      setItems((current) => append ? [...current, ...(payload.data?.items ?? [])] : (payload.data?.items ?? []));
      setNextCursor(payload.data?.nextCursor ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.errorBody);
      if (!append) setItems([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [accountId, copy.errorBody, enabled, queryString]);

  useEffect(() => {
    if (!enabled || !accountId) {
      setItems([]);
      setNextCursor(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void loadActivity(null, false);
    }, search.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [accountId, enabled, loadActivity, search]);

  if (!enabled || !accountId) {
    return (
      <div className="cd-card">
        <div className="cd-act-empty">
          <h3>{copy.emptyTitle}</h3>
          <p>{copy.emptyBody}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cd-view cd-act-view">
      <div className="cd-act-head">
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
      </div>

      <div className="cd-act-toolbar">
        <input
          type="search"
          className="cd-tg2-search cd-act-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={copy.searchPh}
          aria-label={copy.searchPh}
        />
        <label className="cd-act-filter">
          <span>{copy.periodLabel}</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
            {(Object.keys(copy.periods) as Period[]).map((key) => (
              <option key={key} value={key}>{copy.periods[key]}</option>
            ))}
          </select>
        </label>
        <label className="cd-act-filter">
          <span>{copy.actionLabel}</span>
          <select value={action} onChange={(event) => setAction(event.target.value)}>
            {copy.actions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="cd-act-filter">
          <span>{copy.resultLabel}</span>
          <select value={result} onChange={(event) => setResult(event.target.value)}>
            {copy.results.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <p className="cd-setup-note">{copy.loading}</p> : null}
      {error ? (
        <div className="cd-act-empty cd-act-error">
          <h3>{copy.title}</h3>
          <p>{error}</p>
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="cd-act-empty">
          <h3>{copy.emptyTitle}</h3>
          <p>{copy.emptyBody}</p>
        </div>
      ) : null}

      {!error && items.length > 0 ? (
        <>
          <div className="cd-act-table-wrap">
            <table className="cd-act-table">
              <thead>
                <tr>
                  <th>{copy.columns.date}</th>
                  <th>{copy.columns.instagram}</th>
                  <th>{copy.columns.target}</th>
                  <th>{copy.columns.touched}</th>
                  <th>{copy.columns.action}</th>
                  <th>{copy.columns.result}</th>
                  <th>{copy.columns.detail}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={`${item.occurredAt}-${index}`}>
                    <td>{formatActivityDate(item.occurredAt, lang)}</td>
                    <td>{item.instagramAccount ?? "—"}</td>
                    <td>{item.targetAccount ?? "—"}</td>
                    <td>{item.touchedAccount ?? "—"}</td>
                    <td>{item.actionLabel}</td>
                    <td><span className={`cd-act-result ${resultClass(item.resultLabel)}`}>{item.resultLabel}</span></td>
                    <td>{item.detailLabel ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cd-act-cards">
            {items.map((item, index) => (
              <article key={`${item.occurredAt}-card-${index}`} className="cd-act-card">
                <div className="cd-act-card-date">{formatActivityDate(item.occurredAt, lang)}</div>
                <div className="cd-act-card-row"><span>{copy.columns.instagram}</span><strong>{item.instagramAccount ?? "—"}</strong></div>
                <div className="cd-act-card-row"><span>{copy.columns.target}</span><strong>{item.targetAccount ?? "—"}</strong></div>
                <div className="cd-act-card-row"><span>{copy.columns.touched}</span><strong>{item.touchedAccount ?? "—"}</strong></div>
                <div className="cd-act-card-row"><span>{copy.columns.action}</span><strong>{item.actionLabel}</strong></div>
                <div className="cd-act-card-row"><span>{copy.columns.result}</span><strong className={`cd-act-result ${resultClass(item.resultLabel)}`}>{item.resultLabel}</strong></div>
                {item.detailLabel ? <p className="cd-act-card-detail">{item.detailLabel}</p> : null}
              </article>
            ))}
          </div>

          {nextCursor ? (
            <div className="cd-act-more">
              <button type="button" className="cd-btn cd-btn-soft" disabled={loadingMore} onClick={() => void loadActivity(nextCursor, true)}>
                {copy.loadMore}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
