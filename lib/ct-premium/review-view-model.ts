import { summarizeBatch } from "./review.ts";
import type { CtProposal, CtProposalBatch } from "./types.ts";

export type CtReviewLanguage = "fr" | "en";
export type CtReviewUiState = "preparing" | "review" | "frozen" | "canceled" | "completed" | "empty" | "error";

export const CT_REVIEW_COPY = Object.freeze({
  fr: {
    title: "Propositions de comptes cibles",
    fiveDays: "Tu disposes de cinq jours pour examiner ces propositions.",
    timeout: "Sans réponse, les propositions encore en attente seront réévaluées puis ajoutées uniquement si elles restent éligibles.",
    rejection: "Une proposition rejetée ne sera jamais acceptée automatiquement.",
    accept: "Accepter", reject: "Rejeter", bulkAccept: "Accepter la sélection", bulkReject: "Rejeter la sélection",
    preparing: "Nous préparons tes propositions.", frozen: "Ce batch est en lecture seule.", canceled: "Ce batch a été annulé.", completed: "La revue est terminée.", empty: "Aucune proposition disponible.", error: "Impossible d’afficher les propositions.", remaining: "Temps restant",
  },
  en: {
    title: "Target account proposals",
    fiveDays: "You have five days to review these proposals.",
    timeout: "If you do not respond, pending proposals will be reviewed again and added only if they remain eligible.",
    rejection: "A rejected proposal will never be accepted automatically.",
    accept: "Accept", reject: "Reject", bulkAccept: "Accept selection", bulkReject: "Reject selection",
    preparing: "We are preparing your proposals.", frozen: "This batch is read-only.", canceled: "This batch was canceled.", completed: "The review is complete.", empty: "No proposals available.", error: "Proposals cannot be displayed.", remaining: "Time remaining",
  },
});

export function projectCtReviewState(batch: CtProposalBatch | null, proposals: readonly CtProposal[], error = false): CtReviewUiState {
  if (error) return "error";
  if (!batch) return proposals.length ? "error" : "empty";
  if (batch.status === "preparing") return "preparing";
  if (batch.status === "frozen") return "frozen";
  if (batch.status === "canceled") return "canceled";
  if (batch.status === "completed") return "completed";
  return proposals.length ? "review" : "empty";
}

export function reviewRemainingMs(batch: CtProposalBatch, now: Date) {
  if (!batch.reviewWindow) return 0;
  return Math.max(0, new Date(batch.reviewWindow.expiresAt).getTime() - now.getTime());
}

export function projectCtReviewView(batch: CtProposalBatch | null, proposals: readonly CtProposal[], now: Date, error = false) {
  return { state: projectCtReviewState(batch, proposals, error), summary: summarizeBatch(proposals), remainingMs: batch ? reviewRemainingMs(batch, now) : 0 };
}
