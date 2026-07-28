"use client";

import { useMemo, useState } from "react";
import type { AccountId, CtProposal, CtProposalBatch, ProposalId, TenantId } from "@/lib/ct-premium/types";
import { CT_REVIEW_COPY, ctInstagramProfileUrl, projectCtReviewView, type CtReviewLanguage } from "@/lib/ct-premium/review-view-model";
import styles from "./CtPremiumReviewPreview.module.css";

export interface CtPremiumReviewPreviewProps {
  tenantId: TenantId;
  accountId: AccountId;
  batch: CtProposalBatch | null;
  proposals: readonly CtProposal[];
  lang: CtReviewLanguage;
  now: Date;
  error?: boolean;
  onAccept?: (proposalId: ProposalId) => void;
  onReject?: (proposalId: ProposalId) => void;
  onBulkAccept?: (proposalIds: readonly ProposalId[]) => void;
  onBulkReject?: (proposalIds: readonly ProposalId[]) => void;
}

function formatRemaining(milliseconds: number, lang: CtReviewLanguage) {
  const totalHours = Math.ceil(milliseconds / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return lang === "fr" ? `${days} j ${hours} h` : `${days}d ${hours}h`;
}

export function CtPremiumReviewPreview({ tenantId, accountId, batch, proposals, lang, now, error = false, onAccept, onReject, onBulkAccept, onBulkReject }: CtPremiumReviewPreviewProps) {
  const copy = CT_REVIEW_COPY[lang];
  const [selected, setSelected] = useState<ProposalId[]>([]);
  const scopedProposals = useMemo(() => proposals.filter((proposal) => proposal.tenantId === tenantId && proposal.accountId === accountId && proposal.batchId === batch?.id), [tenantId, accountId, batch?.id, proposals]);
  const crossAccountData = proposals.length !== scopedProposals.length;
  const view = projectCtReviewView(batch?.tenantId === tenantId && batch?.accountId === accountId ? batch : null, scopedProposals, now, error || crossAccountData);
  const pendingSelected = selected.filter((id) => scopedProposals.some((proposal) => proposal.id === id && proposal.status === "pending"));

  if (view.state !== "review") {
    const message = view.state === "preparing" ? copy.preparing : view.state === "frozen" ? copy.frozen : view.state === "canceled" ? copy.canceled : view.state === "completed" ? copy.completed : view.state === "error" ? copy.error : copy.empty;
    return <section className={styles.shell} aria-labelledby="ct-premium-title"><h2 id="ct-premium-title">{copy.title}</h2><div className={styles.state} role={view.state === "error" ? "alert" : "status"}>{message}</div></section>;
  }

  return (
    <section className={styles.shell} aria-labelledby="ct-premium-title">
      <header className={styles.header}>
        <div className={styles.copy}>
          <h2 id="ct-premium-title">{copy.title}</h2>
          <p>{view.summary.total} {lang === "fr" ? "propositions" : "proposals"}</p>
        </div>
        <strong>{copy.remaining}: {formatRemaining(view.remainingMs, lang)}</strong>
      </header>
      <div className={styles.notice} role="note"><p>{copy.fiveDays}</p><p>{copy.timeout}</p><p>{copy.rejection}</p></div>
      <div className={styles.toolbar} aria-label={lang === "fr" ? "Actions groupées" : "Bulk actions"}>
        <button data-testid="ct-bulk-accept" type="button" className={`${styles.button} ${styles.primary}`} disabled={!pendingSelected.length} onClick={() => onBulkAccept?.(pendingSelected)}>{copy.bulkAccept}</button>
        <button data-testid="ct-bulk-reject" type="button" className={styles.button} disabled={!pendingSelected.length} onClick={() => onBulkReject?.(pendingSelected)}>{copy.bulkReject}</button>
        <span aria-live="polite">{pendingSelected.length} {lang === "fr" ? "sélectionnée(s)" : "selected"}</span>
      </div>
      <div className={styles.grid}>
        {scopedProposals.map((proposal) => {
          const pending = proposal.status === "pending";
          const inputId = `ct-select-${proposal.id}`;
          return (
            <article className={styles.card} data-testid={`ct-proposal-card-${proposal.id}`} key={proposal.id}>
              <header><div><h3><a className={styles.profileLink} data-testid={`ct-profile-link-${proposal.id}`} href={ctInstagramProfileUrl(proposal.normalizedUsername)} target="_blank" rel="noopener noreferrer" aria-label={lang === "fr" ? `Ouvrir le profil Instagram de @${proposal.normalizedUsername} dans un nouvel onglet` : `Open @${proposal.normalizedUsername}'s Instagram profile in a new tab`}>@{proposal.normalizedUsername}<span aria-hidden="true"> ↗</span></a></h3><p>{proposal.displayName}</p></div><span className={styles.score}>{proposal.score.total}/100</span></header>
              <p>{proposal.score.band} · {proposal.followersCount ?? "—"} followers</p>
              <p>{proposal.score.positiveReasons.join(", ") || (lang === "fr" ? "Score explicable disponible" : "Explainable score available")}</p>
              <label htmlFor={inputId}><input id={inputId} type="checkbox" checked={selected.includes(proposal.id)} disabled={!pending} onChange={(event) => setSelected((current) => event.target.checked ? [...current, proposal.id] : current.filter((id) => id !== proposal.id))} /> {lang === "fr" ? "Sélectionner" : "Select"}</label>
              <div className={styles.actions}>
                <button type="button" className={`${styles.button} ${styles.primary}`} disabled={!pending} onClick={() => onAccept?.(proposal.id)}>{copy.accept}</button>
                <button type="button" className={styles.button} disabled={!pending} onClick={() => onReject?.(proposal.id)}>{copy.reject}</button>
              </div>
              {!pending ? <span role="status">{proposal.status}</span> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default CtPremiumReviewPreview;
