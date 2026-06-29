import {
  canPersistNeedsMoreTargetsEmailAutomation,
  evaluateNeedsMoreTargetsEmailAutomationGate,
} from "./client-email-needs-more-targets-automation-config.ts";
import {
  evaluateNeedsMoreReminderDue,
  type NeedsMoreReminderDueEvaluation,
  type NeedsMoreReminderDueReason,
} from "./client-email-needs-more-24h-due.ts";
import {
  planNeedsMoreTargetsEpisodeReconciliation,
  type NeedsMoreTargetsEpisodePlan,
  type NeedsMoreTargetsSequenceRecord,
} from "./client-email-needs-more-targets-sequence.ts";
import {
  probeNeedsMoreTargetsSequenceSchema,
  type NeedsMoreTargetsAccountSnapshot,
} from "./client-email-needs-more-targets-reconcile.ts";
import {
  isNeedsMoreSignalEligibleAfterWatermark,
  readClientEmailNeedsMoreTargetsAutomationEnabledAt,
} from "./client-email-lifecycle-automation-gates.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

export type NeedsMoreTargetsRunnerMode = "preview" | "materialize";

export type NeedsMoreTargetsRunnerEvaluation = {
  accountId: string;
  clientId: string;
  eligibleTargetCount: number;
  needsMoreSignalActive: boolean;
  needsMoreActiveSince: string | null;
  sourceActionId: string | null;
  accountCanceled: boolean;
  clientEmailAvailable: boolean;
  dueEvaluation: NeedsMoreReminderDueEvaluation;
  plan: NeedsMoreTargetsEpisodePlan;
};

export type NeedsMoreTargetsRunnerResult = {
  mode: NeedsMoreTargetsRunnerMode;
  readOnly: boolean;
  mutationExecuted: false;
  automationGateOpen: boolean;
  materializationGateOpen: false;
  sequenceSchemaReady: boolean;
  evaluatedAt: string;
  evaluations: NeedsMoreTargetsRunnerEvaluation[];
  stoppedBeforeWrite: true;
  stopReason: NeedsMoreReminderDueReason | "gates_closed" | "preview_mode";
};

export async function runNeedsMoreTargetsReminderRunner(
  supabase: ClientEmailSupabase,
  input: {
    snapshots: NeedsMoreTargetsAccountSnapshot[];
    activeEpisodesByAccount?: Map<string, NeedsMoreTargetsSequenceRecord>;
    mode?: NeedsMoreTargetsRunnerMode;
    now?: Date;
    env?: Record<string, string | undefined>;
    clientEmailAvailability?: Map<string, boolean>;
    sourceActionUpdatedAtByAccount?: Map<string, string | null>;
  },
): Promise<NeedsMoreTargetsRunnerResult> {
  const mode = input.mode ?? "preview";
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const gate = evaluateNeedsMoreTargetsEmailAutomationGate(env);
  const schema = await probeNeedsMoreTargetsSequenceSchema(supabase);
  const watermark = (() => {
    const raw = readClientEmailNeedsMoreTargetsAutomationEnabledAt(env);
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  })();
  const persistAllowed = gate.allowed && schema.available && canPersistNeedsMoreTargetsEmailAutomation(env);
  void persistAllowed;

  const evaluations: NeedsMoreTargetsRunnerEvaluation[] = [];

  for (const snapshot of input.snapshots) {
    const legacyPreWatermark = snapshot.needsMoreSignalActive
      && watermark != null
      && !isNeedsMoreSignalEligibleAfterWatermark({
        createdAt: snapshot.needsMoreActiveSince,
        updatedAt: input.sourceActionUpdatedAtByAccount?.get(snapshot.accountId) ?? snapshot.needsMoreActiveSince,
        watermark,
      });

    const clientEmailAvailable = input.clientEmailAvailability?.get(snapshot.accountId) ?? true;
    const activeEpisode = input.activeEpisodesByAccount?.get(snapshot.accountId) ?? null;

    const dueEvaluation = evaluateNeedsMoreReminderDue({
      needsMoreActiveSince: snapshot.needsMoreActiveSince,
      now,
      eligibleTargetCount: snapshot.eligibleTargetCount,
      needsMoreSignalActive: snapshot.needsMoreSignalActive,
      accountCanceled: snapshot.accountCanceled,
      clientEmailAvailable,
      legacyPreWatermark,
    });

    const plan = planNeedsMoreTargetsEpisodeReconciliation({
      ...snapshot,
      activeEpisode,
      now,
    });

    evaluations.push({
      accountId: snapshot.accountId,
      clientId: snapshot.clientId,
      eligibleTargetCount: snapshot.eligibleTargetCount,
      needsMoreSignalActive: snapshot.needsMoreSignalActive,
      needsMoreActiveSince: snapshot.needsMoreActiveSince,
      sourceActionId: snapshot.sourceActionId,
      accountCanceled: snapshot.accountCanceled,
      clientEmailAvailable,
      dueEvaluation,
      plan,
    });
  }

  const stopReason: NeedsMoreTargetsRunnerResult["stopReason"] = mode === "preview"
    ? "preview_mode"
    : "gates_closed";

  return {
    mode,
    readOnly: true,
    mutationExecuted: false,
    automationGateOpen: gate.allowed,
    materializationGateOpen: false,
    sequenceSchemaReady: schema.available,
    evaluatedAt: now.toISOString(),
    evaluations,
    stoppedBeforeWrite: true,
    stopReason,
  };
}
