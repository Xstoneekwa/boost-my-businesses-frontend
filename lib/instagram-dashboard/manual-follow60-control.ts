import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";
import {
  attachArmedFollow60Contract,
  projectArmedFollow60Candidate,
  resolveArmedFollow60Control,
  type Follow60ControlRow,
} from "./auto-restart-follow60-armed-control.ts";
import {
  buildAutoRestartResumePlanMetadata,
  validateCanonicalResumePlan,
} from "./auto-restart-resume-metadata.ts";

export type ManualFollow60ContractResult =
  | { matched: false; ok: true; reason: ""; metadata: null }
  | { matched: true; ok: false; reason: string; metadata: null }
  | { matched: true; ok: true; reason: ""; metadata: Record<string, unknown> };

/**
 * Project BotApp Play onto the same immutable Follow60 request contract used by
 * the natural Auto Restart scheduler.  This function is pure: it creates no
 * request, control, run, tick, lock or device action.
 */
export function buildManualFollow60RequestContract(input: {
  accountId: string;
  controlRow: Follow60ControlRow | null | undefined;
  activeControlCount: number;
  candidate: AutoRestartCandidate | null | undefined;
  now?: Date;
}): ManualFollow60ContractResult {
  if (!input.controlRow) {
    return { matched: false, ok: true, reason: "", metadata: null };
  }
  if (!input.candidate || input.candidate.accountId !== input.accountId) {
    return {
      matched: true,
      ok: false,
      reason: "follow60_manual_play_candidate_missing",
      metadata: null,
    };
  }
  const now = input.now ?? new Date();
  const resolution = resolveArmedFollow60Control({
    row: input.controlRow,
    candidate: input.candidate,
    now,
    globalActiveControlCount: input.activeControlCount,
  });
  if (!resolution.matched || !resolution.ok || !resolution.control) {
    return {
      matched: true,
      ok: false,
      reason: resolution.reason || "follow60_manual_play_control_invalid",
      metadata: null,
    };
  }
  const projected = projectArmedFollow60Candidate(
    input.candidate,
    resolution.control,
  );
  if (!projected.sourceRunId) {
    return {
      matched: true,
      ok: false,
      reason: "follow60_manual_play_source_run_missing",
      metadata: null,
    };
  }
  const base = buildAutoRestartResumePlanMetadata(projected, now);
  const metadata = attachArmedFollow60Contract(
    base,
    resolution.control,
    projected.sourceRunId,
    {
      welcome: input.candidate.plannedQuotaRemaining.welcome,
      unfollow: input.candidate.plannedQuotaRemaining.unfollow,
      outreach: input.candidate.plannedQuotaRemaining.outreach,
    },
  );
  const schemaReason = validateCanonicalResumePlan(metadata.resume_plan);
  if (schemaReason) {
    return {
      matched: true,
      ok: false,
      reason: `follow60_manual_play_${schemaReason}`,
      metadata: null,
    };
  }
  return {
    matched: true,
    ok: true,
    reason: "",
    metadata: {
      ...metadata,
      source: "auto_restart_tick",
      trigger: "manual_operator",
      trigger_source: "botapp_manual_play",
      auto_restart: true,
      manual_play: true,
      manual_play_contract: "FOLLOW60_CANONICAL_PLAY_V1",
    },
  };
}
