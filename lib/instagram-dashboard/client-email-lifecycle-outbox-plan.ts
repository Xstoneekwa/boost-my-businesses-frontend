import {
  CLIENT_EMAIL_TEMPLATE_CATEGORIES,
  type ClientEmailSendTrigger,
  type ClientEmailTemplateCategory,
} from "./client-email-constants.ts";
import { maskEmailForDisplay } from "./client-email-test-config.ts";
import {
  projectClientContactEmailDisplay,
  resolveClientCommunicationEmail,
} from "./client-communication-email.ts";
import {
  buildClientEmailDemoValues,
  buildIntentDeliverySnapshotFields,
  resolveTransactionalDeliverySettings,
  type ResolvedTransactionalDeliverySettings,
} from "./client-email-delivery-settings.ts";
import type { ClientEmailIntentParentType } from "./client-email-intent-parent-contract.ts";
import {
  evaluateClientEmailLifecycleAutomationGate,
  evaluateNeedsMoreTargetsOutboxGate,
  isNeedsMoreSignalEligibleAfterWatermark,
  readClientEmailLifecycleAutomationEnabled,
  readClientEmailNeedsMoreTargetsAutomationEnabledAt,
} from "./client-email-lifecycle-automation-gates.ts";
import {
  readClientEmailNeedsMoreTargetsAutomationEnabled,
} from "./client-email-needs-more-targets-automation-config.ts";
import {
  buildLifecycleEpisodeKey,
  buildLifecycleIntentIdempotencyKey,
  CLIENT_EMAIL_LIFECYCLE_EPISODE_CATEGORIES,
  CLIENT_EMAIL_LIFECYCLE_EPISODES_TABLE,
  CLIENT_EMAIL_LIFECYCLE_START_AUDIT_MESSAGES,
  type ClientEmailLifecycleEpisodeCategory,
  type ClientEmailLifecycleEpisodeStatus,
  type ClientEmailLifecycleTransitionEvidence,
  isLifecycleCategoryStateActive,
  normalizeAdminLifecycleStatus,
  planClientEmailLifecyclePreview,
  readClientEmailLifecycleAutomationEnabledAt,
} from "./client-email-lifecycle-contract.ts";
import {
  probeLifecycleEpisodeSchema,
  projectLifecycleEpisodeRecord,
} from "./client-email-lifecycle-preview.ts";
import {
  buildNeedsMoreTargetsEpisodeKey,
  buildNeedsMoreTargetsIntentIdempotencyKey,
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE,
  planNeedsMoreTargetsEpisodeReconciliation,
  type NeedsMoreTargetsSequenceRecord,
} from "./client-email-needs-more-targets-sequence.ts";
import {
  probeNeedsMoreTargetsSequenceSchema,
  projectSequenceRecord,
} from "./client-email-needs-more-targets-reconcile.ts";
import {
  evaluateClientEmailSendingGate,
  readClientEmailProviderEnv,
} from "./client-email-provider-config.ts";
import {
  CLIENT_EMAIL_TEMPLATES_TABLE,
  isClientEmailInfrastructureTableMissingError,
  readErrorMessage,
} from "./client-email-schema-guard.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";
import { buildTemplatePreview } from "./client-email-template-render.ts";
import { NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE } from "./needs-more-target-accounts.ts";
import { loadTargetEligibilityCountsByAccount } from "./account-target-eligibility.ts";

type SupabaseRecord = Record<string, unknown>;

export type ClientEmailOutboxDecision =
  | "would_open_episode"
  | "would_create_initial_intent"
  | "would_create_reminder_intent"
  | "would_close_episode"
  | "would_cancel_episode"
  | "blocked_legacy_pre_watermark"
  | "blocked_missing_client_email"
  | "blocked_template_unavailable"
  | "blocked_delivery_gate"
  | "no_action";

export type ClientEmailOutboxFutureIntentSnapshot = {
  templateId: string;
  templateVersion: number;
  snapshotSubject: string;
  snapshotBodyText: string;
  snapshotBodyHtml: string;
  fromEmailSnapshot: string;
  supportEmailSnapshot: string;
  configVersion: number;
  category: ClientEmailTemplateCategory;
  trigger: ClientEmailSendTrigger;
  reminderIndex: number | null;
  parentType: Exclude<ClientEmailIntentParentType, null>;
  parentKey: string;
  idempotencyKey: string;
};

export type ClientEmailOutboxPlanRow = {
  accountId: string;
  clientId: string;
  instagramUsername: string | null;
  clientLabel: string | null;
  clientEmailMasked: string | null;
  category: ClientEmailTemplateCategory;
  parentType: ClientEmailIntentParentType;
  parentKey: string | null;
  parentId: string | null;
  trigger: ClientEmailSendTrigger | null;
  reminderIndex: number | null;
  businessState: string;
  decision: ClientEmailOutboxDecision;
  reason: string;
  idempotencyKey: string | null;
  activeTemplateId: string | null;
  activeTemplateVersion: number | null;
  fromEmailSnapshot: string;
  supportEmailSnapshot: string;
  configVersion: number;
  futureIntentSnapshot: ClientEmailOutboxFutureIntentSnapshot | null;
};

export type ClientEmailLifecycleOutboxPlan = {
  plannedAt: string;
  readOnly: true;
  mutationExecuted: false;
  schemaIntentLinksReady: boolean;
  lifecycleSchemaReady: boolean;
  needsMoreSchemaReady: boolean;
  globalSendingEnabled: boolean;
  lifecycleAutomationEnabled: boolean;
  needsMoreAutomationEnabled: boolean;
  lifecycleWatermarkConfigured: boolean;
  needsMoreWatermarkConfigured: boolean;
  providerDispatchAllowed: boolean;
  accountsAnalyzed: number;
  rows: ClientEmailOutboxPlanRow[];
};

const ACTIVE_NEEDS_MORE_STATUSES = ["pending", "acknowledged", "pending_verification"] as const;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function isAccountCanceled(adminLifecycleStatus: string) {
  const lifecycle = normalizeAdminLifecycleStatus(adminLifecycleStatus);
  return lifecycle === "cancelled" || lifecycle === "canceled";
}

export function isIntentEpisodeLinksSchemaMissingError(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase();
  if (!message.includes("client_email_send_intents")) return false;
  return message.includes("lifecycle_episode_id")
    || message.includes("schema cache")
    || message.includes("does not exist")
    || message.includes("42703");
}

export async function probeIntentEpisodeLinksSchema(
  supabase: ClientEmailSupabase,
): Promise<{ available: true } | { available: false }> {
  const { error } = await supabase
    .from("client_email_send_intents")
    .select("id,lifecycle_episode_id,sequence_id")
    .limit(1);
  if (!error) return { available: true };
  if (isIntentEpisodeLinksSchemaMissingError(error)) return { available: false };
  if (isClientEmailInfrastructureTableMissingError(error)) return { available: false };
  throw new Error(readErrorMessage(error));
}

type ActiveTemplate = {
  id: string;
  category: ClientEmailTemplateCategory;
  version: number;
  subject: string;
  bodyText: string;
};

async function loadActiveTemplatesByCategory(supabase: ClientEmailSupabase) {
  const out = new Map<ClientEmailTemplateCategory, ActiveTemplate>();
  const { data, error } = await supabase
    .from(CLIENT_EMAIL_TEMPLATES_TABLE)
    .select("id,category,version,status,subject,body_text")
    .eq("status", "active");
  if (error) {
    if (isClientEmailInfrastructureTableMissingError(error)) return out;
    throw new Error(readErrorMessage(error));
  }
  for (const row of data ?? []) {
    const record = row as SupabaseRecord;
    const category = readString(record.category, "") as ClientEmailTemplateCategory;
    if (!CLIENT_EMAIL_TEMPLATE_CATEGORIES.includes(category)) continue;
    out.set(category, {
      id: readString(record.id, ""),
      category,
      version: Number(record.version) || 0,
      subject: readString(record.subject, ""),
      bodyText: readString(record.body_text, ""),
    });
  }
  return out;
}

function buildFutureIntentSnapshot(input: {
  category: ClientEmailTemplateCategory;
  trigger: ClientEmailSendTrigger;
  reminderIndex: number | null;
  parentType: Exclude<ClientEmailIntentParentType, null>;
  parentKey: string;
  idempotencyKey: string;
  template: ActiveTemplate;
  deliverySettings: ResolvedTransactionalDeliverySettings;
  demoValues: ReturnType<typeof buildClientEmailDemoValues>;
}): ClientEmailOutboxFutureIntentSnapshot {
  const preview = buildTemplatePreview(input.template.subject, input.template.bodyText, input.demoValues);
  const deliveryFields = buildIntentDeliverySnapshotFields(input.deliverySettings);
  return {
    templateId: input.template.id,
    templateVersion: input.template.version,
    snapshotSubject: preview.subject,
    snapshotBodyText: preview.bodyText,
    snapshotBodyHtml: preview.bodyHtml,
    fromEmailSnapshot: deliveryFields.from_email_snapshot,
    supportEmailSnapshot: deliveryFields.support_email_snapshot,
    configVersion: input.deliverySettings.configVersion,
    category: input.category,
    trigger: input.trigger,
    reminderIndex: input.reminderIndex,
    parentType: input.parentType,
    parentKey: input.parentKey,
    idempotencyKey: input.idempotencyKey,
  };
}

function resolveDeliveryGateDecision(
  category: ClientEmailTemplateCategory,
  env: Record<string, string | undefined>,
): ClientEmailOutboxDecision | null {
  const sendingGate = evaluateClientEmailSendingGate(env);
  if (!sendingGate.allowed) return "blocked_delivery_gate";

  if (category === "needs_more_target_accounts") {
    const gate = evaluateNeedsMoreTargetsOutboxGate(env);
    if (!gate.allowed) return "blocked_delivery_gate";
    return null;
  }

  const gate = evaluateClientEmailLifecycleAutomationGate(env);
  if (!gate.allowed) return "blocked_delivery_gate";
  return null;
}

export function mapLifecyclePreviewToOutboxDecisions(input: {
  category: ClientEmailLifecycleEpisodeCategory;
  accountId: string;
  clientId: string;
  instagramUsername: string | null;
  clientLabel: string | null;
  clientEmailMasked: string | null;
  adminLifecycleStatus: string;
  automationEnabledAt: Date | null;
  transitionEvidence: ClientEmailLifecycleTransitionEvidence | null;
  activeEpisode: { id: string; status: ClientEmailLifecycleEpisodeStatus; startedAt: string; episodeKey: string } | null;
  clientEmailAvailable: boolean;
  deliverySettings: ResolvedTransactionalDeliverySettings;
  template: ActiveTemplate | null;
  env: Record<string, string | undefined>;
  now: Date;
  existingIdempotencyKeys: Set<string>;
}): ClientEmailOutboxPlanRow[] {
  const rows: ClientEmailOutboxPlanRow[] = [];
  const accountCanceled = isAccountCanceled(input.adminLifecycleStatus);
  const deliveryFields = buildIntentDeliverySnapshotFields(input.deliverySettings);
  const base = {
    accountId: input.accountId,
    clientId: input.clientId,
    instagramUsername: input.instagramUsername,
    clientLabel: input.clientLabel,
    clientEmailMasked: input.clientEmailMasked,
    category: input.category as ClientEmailTemplateCategory,
    fromEmailSnapshot: deliveryFields.from_email_snapshot,
    supportEmailSnapshot: deliveryFields.support_email_snapshot,
    configVersion: input.deliverySettings.configVersion,
  };

  const planned = planClientEmailLifecyclePreview({
    category: input.category,
    adminLifecycleStatus: input.adminLifecycleStatus,
    automationEnabledAt: input.automationEnabledAt,
    transitionEvidence: input.transitionEvidence,
    activeEpisodeStatus: input.activeEpisode?.status ?? null,
    clientEmailAvailable: input.clientEmailAvailable,
  });

  const pushRow = (row: Omit<ClientEmailOutboxPlanRow, keyof typeof base> & Partial<typeof base>) => {
    rows.push({ ...base, ...row } as ClientEmailOutboxPlanRow);
  };

  if (planned.lifecycleDecision === "legacy_state_no_backfill") {
    pushRow({
      parentType: null,
      parentKey: null,
      parentId: null,
      trigger: null,
      reminderIndex: null,
      businessState: input.adminLifecycleStatus,
      decision: "blocked_legacy_pre_watermark",
      reason: planned.reason,
      idempotencyKey: null,
      activeTemplateId: input.template?.id ?? null,
      activeTemplateVersion: input.template?.version ?? null,
      futureIntentSnapshot: null,
    });
    return rows;
  }

  if (planned.lifecycleDecision === "would_resolve_episode" && input.activeEpisode) {
    const decision = accountCanceled && input.category !== "account_canceled"
      ? "would_cancel_episode"
      : "would_close_episode";
    pushRow({
      parentType: "lifecycle_episode",
      parentKey: input.activeEpisode.episodeKey,
      parentId: input.activeEpisode.id,
      trigger: null,
      reminderIndex: null,
      businessState: input.adminLifecycleStatus,
      decision,
      reason: `${decision === "would_cancel_episode" ? "Account canceled before dispatch; episode would cancel." : "Lifecycle state cleared; episode would resolve."} ${planned.reason}`,
      idempotencyKey: null,
      activeTemplateId: input.template?.id ?? null,
      activeTemplateVersion: input.template?.version ?? null,
      futureIntentSnapshot: null,
    });
    return rows;
  }

  if (planned.lifecycleDecision === "would_open_episode_on_future_transition") {
    const startedAtIso = input.transitionEvidence?.occurredAt ?? input.now.toISOString();
    const episodeKey = buildLifecycleEpisodeKey(input.category, input.accountId, startedAtIso);
    const episodeId = input.activeEpisode?.id ?? episodeKey;

    pushRow({
      parentType: "lifecycle_episode",
      parentKey: episodeKey,
      parentId: input.activeEpisode?.id ?? null,
      trigger: null,
      reminderIndex: null,
      businessState: input.adminLifecycleStatus,
      decision: "would_open_episode",
      reason: `Post-watermark transition would open one ${input.category.replaceAll("_", " ")} episode. ${planned.reason}`,
      idempotencyKey: null,
      activeTemplateId: input.template?.id ?? null,
      activeTemplateVersion: input.template?.version ?? null,
      futureIntentSnapshot: null,
    });

    const deliveryGate = resolveDeliveryGateDecision(input.category, input.env);
    if (deliveryGate) {
      pushRow({
        parentType: "lifecycle_episode",
        parentKey: episodeKey,
        parentId: input.activeEpisode?.id ?? null,
        trigger: "automatic_initial",
        reminderIndex: 0,
        businessState: input.adminLifecycleStatus,
        decision: deliveryGate,
        reason: "Automation or provider dispatch gates remain closed.",
        idempotencyKey: buildLifecycleIntentIdempotencyKey({
          category: input.category,
          accountId: input.accountId,
          episodeId,
        }),
        activeTemplateId: input.template?.id ?? null,
        activeTemplateVersion: input.template?.version ?? null,
        futureIntentSnapshot: null,
      });
      return rows;
    }

    if (!input.clientEmailAvailable) {
      pushRow({
        parentType: "lifecycle_episode",
        parentKey: episodeKey,
        parentId: input.activeEpisode?.id ?? null,
        trigger: "automatic_initial",
        reminderIndex: 0,
        businessState: input.adminLifecycleStatus,
        decision: "blocked_missing_client_email",
        reason: "Canonical client communication email is not configured.",
        idempotencyKey: buildLifecycleIntentIdempotencyKey({
          category: input.category,
          accountId: input.accountId,
          episodeId,
        }),
        activeTemplateId: input.template?.id ?? null,
        activeTemplateVersion: input.template?.version ?? null,
        futureIntentSnapshot: null,
      });
      return rows;
    }

    if (accountCanceled && input.category !== "account_canceled") {
      pushRow({
        parentType: "lifecycle_episode",
        parentKey: episodeKey,
        parentId: input.activeEpisode?.id ?? null,
        trigger: null,
        reminderIndex: null,
        businessState: input.adminLifecycleStatus,
        decision: "would_cancel_episode",
        reason: "Account canceled; pause/assistance email would not send. Cancellation category decides separately.",
        idempotencyKey: null,
        activeTemplateId: input.template?.id ?? null,
        activeTemplateVersion: input.template?.version ?? null,
        futureIntentSnapshot: null,
      });
      return rows;
    }

    if (!input.template?.id) {
      pushRow({
        parentType: "lifecycle_episode",
        parentKey: episodeKey,
        parentId: input.activeEpisode?.id ?? null,
        trigger: "automatic_initial",
        reminderIndex: 0,
        businessState: input.adminLifecycleStatus,
        decision: "blocked_template_unavailable",
        reason: `No active template is configured for ${input.category.replaceAll("_", " ")}.`,
        idempotencyKey: buildLifecycleIntentIdempotencyKey({
          category: input.category,
          accountId: input.accountId,
          episodeId,
        }),
        activeTemplateId: null,
        activeTemplateVersion: null,
        futureIntentSnapshot: null,
      });
      return rows;
    }

    const idempotencyKey = buildLifecycleIntentIdempotencyKey({
      category: input.category,
      accountId: input.accountId,
      episodeId,
    });
    if (input.existingIdempotencyKeys.has(idempotencyKey)) {
      pushRow({
        parentType: "lifecycle_episode",
        parentKey: episodeKey,
        parentId: input.activeEpisode?.id ?? null,
        trigger: "automatic_initial",
        reminderIndex: 0,
        businessState: input.adminLifecycleStatus,
        decision: "no_action",
        reason: "Matching idempotency key already exists; no duplicate intent would be created.",
        idempotencyKey,
        activeTemplateId: input.template.id,
        activeTemplateVersion: input.template.version,
        futureIntentSnapshot: null,
      });
      return rows;
    }

    const demoValues = buildClientEmailDemoValues(input.deliverySettings);
    pushRow({
      parentType: "lifecycle_episode",
      parentKey: episodeKey,
      parentId: input.activeEpisode?.id ?? null,
      trigger: "automatic_initial",
      reminderIndex: 0,
      businessState: input.adminLifecycleStatus,
      decision: "would_create_initial_intent",
      reason: `Initial ${input.category.replaceAll("_", " ")} client intent would be created with lifecycle episode parent.`,
      idempotencyKey,
      activeTemplateId: input.template.id,
      activeTemplateVersion: input.template.version,
      futureIntentSnapshot: buildFutureIntentSnapshot({
        category: input.category,
        trigger: "automatic_initial",
        reminderIndex: 0,
        parentType: "lifecycle_episode",
        parentKey: episodeKey,
        idempotencyKey,
        template: input.template,
        deliverySettings: input.deliverySettings,
        demoValues,
      }),
    });
    return rows;
  }

  pushRow({
    parentType: input.activeEpisode ? "lifecycle_episode" : null,
    parentKey: input.activeEpisode?.episodeKey ?? null,
    parentId: input.activeEpisode?.id ?? null,
    trigger: null,
    reminderIndex: null,
    businessState: input.adminLifecycleStatus,
    decision: "no_action",
    reason: planned.reason,
    idempotencyKey: null,
    activeTemplateId: input.template?.id ?? null,
    activeTemplateVersion: input.template?.version ?? null,
    futureIntentSnapshot: null,
  });
  return rows;
}

export function mapNeedsMorePlanToOutboxRows(input: {
  accountId: string;
  clientId: string;
  instagramUsername: string | null;
  clientLabel: string | null;
  clientEmailMasked: string | null;
  adminLifecycleStatus: string;
  eligibleTargetCount: number;
  needsMoreSignalActive: boolean;
  sourceActionId: string | null;
  sourceActionCreatedAt: string | null;
  sourceActionUpdatedAt: string | null;
  activeEpisode: NeedsMoreTargetsSequenceRecord | null;
  clientEmailAvailable: boolean;
  deliverySettings: ResolvedTransactionalDeliverySettings;
  template: ActiveTemplate | null;
  env: Record<string, string | undefined>;
  needsMoreWatermark: Date | null;
  now: Date;
  existingIdempotencyKeys: Set<string>;
}): ClientEmailOutboxPlanRow[] {
  const rows: ClientEmailOutboxPlanRow[] = [];
  const deliveryFields = buildIntentDeliverySnapshotFields(input.deliverySettings);
  const accountCanceled = isAccountCanceled(input.adminLifecycleStatus);
  const base = {
    accountId: input.accountId,
    clientId: input.clientId,
    instagramUsername: input.instagramUsername,
    clientLabel: input.clientLabel,
    clientEmailMasked: input.clientEmailMasked,
    category: "needs_more_target_accounts" as const,
    fromEmailSnapshot: deliveryFields.from_email_snapshot,
    supportEmailSnapshot: deliveryFields.support_email_snapshot,
    configVersion: input.deliverySettings.configVersion,
  };

  const pushRow = (row: Omit<ClientEmailOutboxPlanRow, keyof typeof base> & Partial<typeof base>) => {
    rows.push({ ...base, ...row } as ClientEmailOutboxPlanRow);
  };

  if (
    !input.activeEpisode
    && input.needsMoreSignalActive
    && !isNeedsMoreSignalEligibleAfterWatermark({
      createdAt: input.sourceActionCreatedAt,
      updatedAt: input.sourceActionUpdatedAt,
      watermark: input.needsMoreWatermark,
    })
  ) {
    pushRow({
      parentType: null,
      parentKey: null,
      parentId: null,
      trigger: null,
      reminderIndex: null,
      businessState: `eligible_targets=${input.eligibleTargetCount};signal_active=true`,
      decision: "blocked_legacy_pre_watermark",
      reason: "Needs-more signal predates automation watermark; no retroactive sequence would start.",
      idempotencyKey: null,
      activeTemplateId: input.template?.id ?? null,
      activeTemplateVersion: input.template?.version ?? null,
      futureIntentSnapshot: null,
    });
    return rows;
  }

  const plan = planNeedsMoreTargetsEpisodeReconciliation({
    accountId: input.accountId,
    clientId: input.clientId,
    accountCanceled,
    eligibleTargetCount: input.eligibleTargetCount,
    needsMoreSignalActive: input.needsMoreSignalActive,
    sourceActionId: input.sourceActionId,
    activeEpisode: input.activeEpisode,
    now: input.now,
  });

  for (const action of plan.actions) {
    if (action.type === "noop") {
      pushRow({
        parentType: input.activeEpisode ? "sequence" : null,
        parentKey: input.activeEpisode?.episodeKey ?? null,
        parentId: input.activeEpisode?.id ?? null,
        trigger: null,
        reminderIndex: null,
        businessState: `eligible_targets=${input.eligibleTargetCount};signal_active=${input.needsMoreSignalActive}`,
        decision: "no_action",
        reason: action.reason,
        idempotencyKey: null,
        activeTemplateId: input.template?.id ?? null,
        activeTemplateVersion: input.template?.version ?? null,
        futureIntentSnapshot: null,
      });
      continue;
    }

    if (action.type === "open_episode") {
      pushRow({
        parentType: "sequence",
        parentKey: action.episodeKey,
        parentId: null,
        trigger: null,
        reminderIndex: null,
        businessState: `eligible_targets=${input.eligibleTargetCount};signal_active=${input.needsMoreSignalActive}`,
        decision: "would_open_episode",
        reason: "Eligible needs-more signal would open a sequence episode.",
        idempotencyKey: null,
        activeTemplateId: input.template?.id ?? null,
        activeTemplateVersion: input.template?.version ?? null,
        futureIntentSnapshot: null,
      });
      continue;
    }

    if (action.type === "close_episode") {
      pushRow({
        parentType: "sequence",
        parentKey: input.activeEpisode?.episodeKey ?? null,
        parentId: input.activeEpisode?.id ?? null,
        trigger: null,
        reminderIndex: null,
        businessState: `eligible_targets=${input.eligibleTargetCount};signal_active=${input.needsMoreSignalActive}`,
        decision: action.closeReason === "account_canceled" ? "would_cancel_episode" : "would_close_episode",
        reason: `Sequence would close: ${action.closeReason.replaceAll("_", " ")}.`,
        idempotencyKey: null,
        activeTemplateId: input.template?.id ?? null,
        activeTemplateVersion: input.template?.version ?? null,
        futureIntentSnapshot: null,
      });
      continue;
    }

    const episodeKey = input.activeEpisode?.episodeKey
      ?? buildNeedsMoreTargetsEpisodeKey(input.accountId, input.now.toISOString());
    const episodeId = input.activeEpisode?.id ?? episodeKey;
    const { send } = action;
    const decision = send.reminderIndex === 0
      ? "would_create_initial_intent"
      : "would_create_reminder_intent";

    const deliveryGate = resolveDeliveryGateDecision("needs_more_target_accounts", input.env);
    if (deliveryGate) {
      pushRow({
        parentType: "sequence",
        parentKey: episodeKey,
        parentId: input.activeEpisode?.id ?? null,
        trigger: send.trigger,
        reminderIndex: send.reminderIndex,
        businessState: `eligible_targets=${input.eligibleTargetCount};signal_active=${input.needsMoreSignalActive}`,
        decision: deliveryGate,
        reason: "Needs-more automation or provider dispatch gates remain closed.",
        idempotencyKey: send.idempotencyKey,
        activeTemplateId: input.template?.id ?? null,
        activeTemplateVersion: input.template?.version ?? null,
        futureIntentSnapshot: null,
      });
      continue;
    }

    if (!input.clientEmailAvailable) {
      pushRow({
        parentType: "sequence",
        parentKey: episodeKey,
        parentId: input.activeEpisode?.id ?? null,
        trigger: send.trigger,
        reminderIndex: send.reminderIndex,
        businessState: `eligible_targets=${input.eligibleTargetCount};signal_active=${input.needsMoreSignalActive}`,
        decision: "blocked_missing_client_email",
        reason: "Canonical client communication email is not configured.",
        idempotencyKey: send.idempotencyKey,
        activeTemplateId: input.template?.id ?? null,
        activeTemplateVersion: input.template?.version ?? null,
        futureIntentSnapshot: null,
      });
      continue;
    }

    if (!input.template?.id) {
      pushRow({
        parentType: "sequence",
        parentKey: episodeKey,
        parentId: input.activeEpisode?.id ?? null,
        trigger: send.trigger,
        reminderIndex: send.reminderIndex,
        businessState: `eligible_targets=${input.eligibleTargetCount};signal_active=${input.needsMoreSignalActive}`,
        decision: "blocked_template_unavailable",
        reason: "No active needs-more template is configured.",
        idempotencyKey: send.idempotencyKey,
        activeTemplateId: null,
        activeTemplateVersion: null,
        futureIntentSnapshot: null,
      });
      continue;
    }

    if (input.existingIdempotencyKeys.has(send.idempotencyKey)) {
      pushRow({
        parentType: "sequence",
        parentKey: episodeKey,
        parentId: input.activeEpisode?.id ?? null,
        trigger: send.trigger,
        reminderIndex: send.reminderIndex,
        businessState: `eligible_targets=${input.eligibleTargetCount};signal_active=${input.needsMoreSignalActive}`,
        decision: "no_action",
        reason: "Matching idempotency key already exists; no duplicate intent would be created.",
        idempotencyKey: send.idempotencyKey,
        activeTemplateId: input.template.id,
        activeTemplateVersion: input.template.version,
        futureIntentSnapshot: null,
      });
      continue;
    }

    const demoValues = buildClientEmailDemoValues(input.deliverySettings);
    pushRow({
      parentType: "sequence",
      parentKey: episodeKey,
      parentId: input.activeEpisode?.id ?? null,
      trigger: send.trigger,
      reminderIndex: send.reminderIndex,
      businessState: `eligible_targets=${input.eligibleTargetCount};signal_active=${input.needsMoreSignalActive}`,
      decision,
      reason: decision === "would_create_initial_intent"
        ? "Initial needs-more client intent would be created with sequence parent."
        : `Reminder ${send.reminderIndex} needs-more client intent would be created.`,
      idempotencyKey: send.idempotencyKey,
      activeTemplateId: input.template.id,
      activeTemplateVersion: input.template.version,
      futureIntentSnapshot: buildFutureIntentSnapshot({
        category: "needs_more_target_accounts",
        trigger: send.trigger,
        reminderIndex: send.reminderIndex,
        parentType: "sequence",
        parentKey: episodeKey,
        idempotencyKey: send.idempotencyKey,
        template: input.template,
        deliverySettings: input.deliverySettings,
        demoValues: {
          ...demoValues,
          eligible_target_count: String(input.eligibleTargetCount),
        },
      }),
    });
  }

  return rows;
}

async function loadExistingClientIdempotencyKeys(supabase: ClientEmailSupabase) {
  const keys = new Set<string>();
  const { data, error } = await supabase
    .from("client_email_send_intents")
    .select("idempotency_key,intent_kind")
    .eq("intent_kind", "client");
  if (error) {
    if (isClientEmailInfrastructureTableMissingError(error)) return keys;
    throw new Error(readErrorMessage(error));
  }
  for (const row of data ?? []) {
    const key = readString((row as SupabaseRecord).idempotency_key, "");
    if (key) keys.add(key);
  }
  return keys;
}

export async function buildClientEmailLifecycleOutboxPlan(
  supabase: ClientEmailSupabase,
  input: { now?: Date; env?: Record<string, string | undefined> } = {},
): Promise<ClientEmailLifecycleOutboxPlan> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;

  const [
    intentLinksSchema,
    lifecycleSchema,
    needsMoreSchema,
    deliverySettings,
    templatesByCategory,
    existingIdempotencyKeys,
  ] = await Promise.all([
    probeIntentEpisodeLinksSchema(supabase),
    probeLifecycleEpisodeSchema(supabase),
    probeNeedsMoreTargetsSequenceSchema(supabase),
    resolveTransactionalDeliverySettings(supabase),
    loadActiveTemplatesByCategory(supabase),
    loadExistingClientIdempotencyKeys(supabase),
  ]);

  const lifecycleWatermark = readClientEmailLifecycleAutomationEnabledAt(env);
  const needsMoreWatermark = readClientEmailNeedsMoreTargetsAutomationEnabledAt(env);
  const providerEnv = readClientEmailProviderEnv(env);

  const accountIds = new Set<string>();

  const { data: lifecycleAccounts, error: lifecycleError } = await supabase
    .from("ig_accounts")
    .select("id,username,admin_lifecycle_status")
    .in("admin_lifecycle_status", ["paused", "cancelled", "canceled", "needs_assistance"]);
  if (lifecycleError) throw new Error(lifecycleError.message);
  for (const row of lifecycleAccounts ?? []) {
    accountIds.add(readString((row as SupabaseRecord).id, ""));
  }

  const { data: signalRows, error: signalError } = await supabase
    .from("account_dashboard_actions")
    .select("account_id")
    .eq("action_type", NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE)
    .in("status", [...ACTIVE_NEEDS_MORE_STATUSES]);
  if (signalError) throw new Error(signalError.message);
  for (const row of signalRows ?? []) {
    accountIds.add(readString((row as SupabaseRecord).account_id, ""));
  }

  if (lifecycleSchema.available) {
    const { data: episodeRows, error: episodeError } = await supabase
      .from(CLIENT_EMAIL_LIFECYCLE_EPISODES_TABLE)
      .select("account_id")
      .eq("status", "active");
    if (episodeError) throw new Error(episodeError.message);
    for (const row of episodeRows ?? []) {
      accountIds.add(readString((row as SupabaseRecord).account_id, ""));
    }
  }

  if (needsMoreSchema.available) {
    const { data: sequenceRows, error: sequenceError } = await supabase
      .from(CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE)
      .select("account_id")
      .eq("status", "active");
    if (sequenceError) throw new Error(sequenceError.message);
    for (const row of sequenceRows ?? []) {
      accountIds.add(readString((row as SupabaseRecord).account_id, ""));
    }
  }

  const sortedAccountIds = [...accountIds].filter(Boolean).sort();
  const rows: ClientEmailOutboxPlanRow[] = [];

  if (sortedAccountIds.length === 0) {
    return {
      plannedAt: now.toISOString(),
      readOnly: true,
      mutationExecuted: false,
      schemaIntentLinksReady: intentLinksSchema.available,
      lifecycleSchemaReady: lifecycleSchema.available,
      needsMoreSchemaReady: needsMoreSchema.available,
      globalSendingEnabled: providerEnv.sendingEnabled,
      lifecycleAutomationEnabled: readClientEmailLifecycleAutomationEnabled(env),
      needsMoreAutomationEnabled: readClientEmailNeedsMoreTargetsAutomationEnabled(env),
      lifecycleWatermarkConfigured: Boolean(lifecycleWatermark),
      needsMoreWatermarkConfigured: Boolean(needsMoreWatermark),
      providerDispatchAllowed: evaluateClientEmailSendingGate(env).allowed,
      accountsAnalyzed: 0,
      rows,
    };
  }

  const { data: links, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("account_id,client_id")
    .in("account_id", sortedAccountIds);
  if (linkError) throw new Error(linkError.message);

  const clientIds = [...new Set(
    (links ?? []).map((row) => readString((row as SupabaseRecord).client_id, "")).filter(Boolean),
  )];

  const [
    { data: accounts, error: accountsError },
    { data: clients, error: clientsError },
  ] = await Promise.all([
    supabase.from("ig_accounts").select("id,username,admin_lifecycle_status").in("id", sortedAccountIds),
    clientIds.length
      ? supabase.from("clients").select("id,name,metadata").in("id", clientIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (accountsError) throw new Error(accountsError.message);
  if (clientsError) throw new Error(clientsError.message);

  const accountById = new Map(
    (accounts ?? []).map((row) => [readString((row as SupabaseRecord).id, ""), row as SupabaseRecord]),
  );
  const clientById = new Map(
    (clients ?? []).map((row) => [readString((row as SupabaseRecord).id, ""), row as SupabaseRecord]),
  );
  const clientIdByAccount = new Map(
    (links ?? []).map((row) => [
      readString((row as SupabaseRecord).account_id, ""),
      readString((row as SupabaseRecord).client_id, ""),
    ]),
  );

  const lifecycleEpisodesByKey = new Map<string, {
    id: string;
    status: ClientEmailLifecycleEpisodeStatus;
    startedAt: string;
    episodeKey: string;
    category: ClientEmailLifecycleEpisodeCategory;
  }>();
  if (lifecycleSchema.available) {
    const { data, error } = await supabase
      .from(CLIENT_EMAIL_LIFECYCLE_EPISODES_TABLE)
      .select("id,account_id,category,status,started_at,episode_key")
      .in("account_id", sortedAccountIds)
      .eq("status", "active");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const episode = projectLifecycleEpisodeRecord(row as SupabaseRecord);
      const record = row as SupabaseRecord;
      lifecycleEpisodesByKey.set(`${episode.accountId}:${episode.category}`, {
        id: readString(record.id, ""),
        status: episode.status,
        startedAt: episode.startedAt,
        episodeKey: readString(record.episode_key, ""),
        category: episode.category,
      });
    }
  }

  const transitionsByKey = new Map<string, ClientEmailLifecycleTransitionEvidence>();
  const startMessages = CLIENT_EMAIL_LIFECYCLE_EPISODE_CATEGORIES.map(
    (category) => CLIENT_EMAIL_LIFECYCLE_START_AUDIT_MESSAGES[category],
  );
  const { data: transitionRows, error: transitionError } = await supabase
    .from("ig_action_logs")
    .select("account_id,message,created_at")
    .eq("action_type", "account_admin_status_changed")
    .in("account_id", sortedAccountIds)
    .in("message", startMessages)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (transitionError) throw new Error(transitionError.message);
  for (const row of transitionRows ?? []) {
    const record = row as SupabaseRecord;
    const accountId = readString(record.account_id, "");
    const message = readString(record.message, "");
    const occurredAt = readString(record.created_at, "");
    const category = CLIENT_EMAIL_LIFECYCLE_EPISODE_CATEGORIES.find(
      (entry) => CLIENT_EMAIL_LIFECYCLE_START_AUDIT_MESSAGES[entry] === message,
    );
    if (!accountId || !category || !occurredAt) continue;
    const key = `${accountId}:${category}`;
    if (!transitionsByKey.has(key)) {
      transitionsByKey.set(key, {
        message,
        occurredAt,
        source: "ig_action_logs.account_admin_status_changed",
      });
    }
  }

  const needsMoreEpisodesByAccount = new Map<string, NeedsMoreTargetsSequenceRecord>();
  if (needsMoreSchema.available) {
    const { data, error } = await supabase
      .from(CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE)
      .select("*")
      .in("account_id", sortedAccountIds)
      .eq("status", "active");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const episode = projectSequenceRecord(row as SupabaseRecord);
      if (episode.accountId) needsMoreEpisodesByAccount.set(episode.accountId, episode);
    }
  }

  const eligibilityByAccount = await loadTargetEligibilityCountsByAccount(supabase, sortedAccountIds);

  for (const accountId of sortedAccountIds) {
    const account = accountById.get(accountId);
    const clientId = clientIdByAccount.get(accountId);
    if (!account || !clientId) continue;

    const clientRow = clientById.get(clientId) ?? null;
    const adminLifecycleStatus = readString(account.admin_lifecycle_status, "active");
    const instagramUsername = readString(account.username, "") || null;
    const clientLabel = readString(clientRow?.name, "") || null;
    const resolvedEmail = resolveClientCommunicationEmail({ client: clientRow, workspaceAuthEmail: null });
    const projectedEmail = projectClientContactEmailDisplay(resolvedEmail);
    const clientEmailMasked = projectedEmail.available
      ? maskEmailForDisplay(projectedEmail.display)
      : null;

    for (const category of CLIENT_EMAIL_LIFECYCLE_EPISODE_CATEGORIES) {
      const episode = lifecycleEpisodesByKey.get(`${accountId}:${category}`) ?? null;
      const currentStateActive = isLifecycleCategoryStateActive(category, adminLifecycleStatus);
      if (!currentStateActive && !episode) continue;

      rows.push(...mapLifecyclePreviewToOutboxDecisions({
        category,
        accountId,
        clientId,
        instagramUsername,
        clientLabel,
        clientEmailMasked,
        adminLifecycleStatus,
        automationEnabledAt: lifecycleWatermark,
        transitionEvidence: transitionsByKey.get(`${accountId}:${category}`) ?? null,
        activeEpisode: episode,
        clientEmailAvailable: projectedEmail.available,
        deliverySettings,
        template: templatesByCategory.get(category) ?? null,
        env,
        now,
        existingIdempotencyKeys,
      }));
    }

    const needsMoreEpisode = needsMoreEpisodesByAccount.get(accountId) ?? null;
    const { data: activeAction } = await supabase
      .from("account_dashboard_actions")
      .select("id,created_at,updated_at")
      .eq("account_id", accountId)
      .eq("action_type", NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE)
      .in("status", [...ACTIVE_NEEDS_MORE_STATUSES])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const needsMoreSignalActive = Boolean(activeAction);
    const eligibleTargetCount = eligibilityByAccount.get(accountId)?.eligible ?? 0;

    if (
      needsMoreSignalActive
      || needsMoreEpisode
      || eligibleTargetCount <= 5
    ) {
      rows.push(...mapNeedsMorePlanToOutboxRows({
        accountId,
        clientId,
        instagramUsername,
        clientLabel,
        clientEmailMasked,
        adminLifecycleStatus,
        eligibleTargetCount,
        needsMoreSignalActive,
        sourceActionId: readString(activeAction?.id, "") || null,
        sourceActionCreatedAt: readString(activeAction?.created_at, "") || null,
        sourceActionUpdatedAt: readString(activeAction?.updated_at, "") || null,
        activeEpisode: needsMoreEpisode,
        clientEmailAvailable: projectedEmail.available,
        deliverySettings,
        template: templatesByCategory.get("needs_more_target_accounts") ?? null,
        env,
        needsMoreWatermark,
        now,
        existingIdempotencyKeys,
      }));
    }
  }

  rows.sort((left, right) => {
    const accountCompare = left.accountId.localeCompare(right.accountId);
    if (accountCompare !== 0) return accountCompare;
    return left.category.localeCompare(right.category);
  });

  return {
    plannedAt: now.toISOString(),
    readOnly: true,
    mutationExecuted: false,
    schemaIntentLinksReady: intentLinksSchema.available,
    lifecycleSchemaReady: lifecycleSchema.available,
    needsMoreSchemaReady: needsMoreSchema.available,
    globalSendingEnabled: providerEnv.sendingEnabled,
    lifecycleAutomationEnabled: readClientEmailLifecycleAutomationEnabled(env),
    needsMoreAutomationEnabled: readClientEmailNeedsMoreTargetsAutomationEnabled(env),
    lifecycleWatermarkConfigured: Boolean(lifecycleWatermark),
    needsMoreWatermarkConfigured: Boolean(needsMoreWatermark),
    providerDispatchAllowed: evaluateClientEmailSendingGate(env).allowed,
    accountsAnalyzed: sortedAccountIds.length,
    rows,
  };
}
