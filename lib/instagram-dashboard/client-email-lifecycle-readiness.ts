import {
  resolveTransactionalDeliverySettings,
  probeTransactionalDeliverySettingsSchema,
} from "./client-email-delivery-settings.ts";
import { probeIntentEpisodeLinksSchema } from "./client-email-lifecycle-outbox-plan.ts";
import {
  readClientEmailLifecycleAutomationEnabled,
  readClientEmailNeedsMoreTargetsAutomationEnabledAt,
} from "./client-email-lifecycle-automation-gates.ts";
import { readClientEmailLifecycleAutomationEnabledAt } from "./client-email-lifecycle-contract.ts";
import { probeLifecycleEpisodeSchema } from "./client-email-lifecycle-preview.ts";
import {
  readClientEmailNeedsMoreTargetsAutomationEnabled,
} from "./client-email-needs-more-targets-automation-config.ts";
import { probeNeedsMoreTargetsSequenceSchema } from "./client-email-needs-more-targets-reconcile.ts";
import {
  evaluateClientEmailSendingGate,
  readClientEmailProviderEnv,
} from "./client-email-provider-config.ts";
import {
  CLIENT_EMAIL_TEMPLATES_TABLE,
  probeClientEmailInfrastructure,
} from "./client-email-schema-guard.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";
import { readClientEmailTestEnv } from "./client-email-test-config.ts";
import { deriveOutboxLayerReadinessStatus, type OutboxLayerReadinessStatus } from "./client-email-lifecycle-outbox-gates.ts";

export type ClientEmailLifecycleReadinessStatus =
  | "blocked"
  | "partial"
  | "ready_for_future_activation";

export type ClientEmailLifecycleReadiness = {
  readOnly: true;
  schemaIntentLinksReady: boolean;
  needsMoreSchemaReady: boolean;
  lifecycleSchemaReady: boolean;
  templatesReady: boolean;
  transactionalSettingsReady: boolean;
  senderConfigured: boolean;
  supportEmailConfigured: boolean;
  globalSendingEnabled: boolean;
  testSendingEnabled: boolean;
  needsMoreAutomationEnabled: boolean;
  lifecycleAutomationEnabled: boolean;
  lifecycleWatermarkConfigured: boolean;
  needsMoreWatermarkConfigured: boolean;
  schedulerConnected: boolean;
  providerDispatchAllowed: boolean;
  materializationReadinessStatus: OutboxLayerReadinessStatus;
  dispatchReadinessStatus: OutboxLayerReadinessStatus;
  materializationBlockingReasons: string[];
  dispatchBlockingReasons: string[];
  finalReadinessStatus: ClientEmailLifecycleReadinessStatus;
  blockingReasons: string[];
};

export async function loadClientEmailLifecycleReadiness(
  supabase: ClientEmailSupabase,
  env: Record<string, string | undefined> = process.env,
): Promise<ClientEmailLifecycleReadiness> {
  const [
    intentLinksSchema,
    needsMoreSchema,
    lifecycleSchema,
    emailInfrastructure,
    deliverySettingsSchema,
    deliverySettings,
  ] = await Promise.all([
    probeIntentEpisodeLinksSchema(supabase),
    probeNeedsMoreTargetsSequenceSchema(supabase),
    probeLifecycleEpisodeSchema(supabase),
    probeClientEmailInfrastructure(supabase),
    probeTransactionalDeliverySettingsSchema(supabase),
    resolveTransactionalDeliverySettings(supabase),
  ]);

  let templatesReady = false;
  if (emailInfrastructure.available) {
    const { count, error } = await supabase
      .from(CLIENT_EMAIL_TEMPLATES_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    templatesReady = !error && (count ?? 0) >= 4;
  }

  const providerEnv = readClientEmailProviderEnv(env);
  const sendingGate = evaluateClientEmailSendingGate(env);
  const lifecycleWatermarkConfigured = Boolean(readClientEmailLifecycleAutomationEnabledAt(env));
  const needsMoreWatermarkConfigured = Boolean(readClientEmailNeedsMoreTargetsAutomationEnabledAt(env));
  const lifecycleAutomationEnabled = readClientEmailLifecycleAutomationEnabled(env);
  const needsMoreAutomationEnabled = readClientEmailNeedsMoreTargetsAutomationEnabled(env);
  const testSendingEnabled = readClientEmailTestEnv(env).testSendingEnabled;

  const senderConfigured = Boolean(deliverySettings.activeFromEmail);
  const supportEmailConfigured = Boolean(deliverySettings.supportEmail);

  const materializationBlockingReasons: string[] = [];
  const dispatchBlockingReasons: string[] = [];

  if (!intentLinksSchema.available) {
    materializationBlockingReasons.push("Intent parent linkage migration is not applied yet.");
  }
  if (!needsMoreSchema.available) {
    materializationBlockingReasons.push("Needs-more sequence schema is not ready.");
  }
  if (!lifecycleSchema.available) {
    materializationBlockingReasons.push("Lifecycle episode schema is not ready.");
  }
  if (!templatesReady) {
    materializationBlockingReasons.push("Active transactional templates are incomplete.");
  }
  if (!deliverySettingsSchema.available) {
    materializationBlockingReasons.push("Transactional delivery settings migration is not applied yet.");
  }
  if (!lifecycleWatermarkConfigured) {
    materializationBlockingReasons.push("Lifecycle anti-backfill watermark is not configured.");
  }
  if (!needsMoreWatermarkConfigured) {
    materializationBlockingReasons.push("Needs-more anti-backfill watermark is not configured.");
  }
  if (!lifecycleAutomationEnabled) {
    materializationBlockingReasons.push("Lifecycle email automation is disabled by CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED.");
  }
  if (!needsMoreAutomationEnabled) {
    materializationBlockingReasons.push("Needs-more-targets email automation is disabled by CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED.");
  }
  if (lifecycleAutomationEnabled) {
    materializationBlockingReasons.push("Lifecycle automation gate is open; materialize writer is not connected yet.");
  }
  if (needsMoreAutomationEnabled) {
    materializationBlockingReasons.push("Needs-more automation gate is open; materialize writer is not connected yet.");
  }

  if (!senderConfigured) {
    dispatchBlockingReasons.push("Active sender email is not configured.");
  }
  if (!supportEmailConfigured) {
    dispatchBlockingReasons.push("Support email is not configured.");
  }
  if (!providerEnv.postmarkServerTokenConfigured) {
    dispatchBlockingReasons.push("Postmark server token is not configured.");
  }
  if (!sendingGate.allowed) {
    dispatchBlockingReasons.push(sendingGate.message);
  }
  if (providerEnv.sendingEnabled) {
    dispatchBlockingReasons.push("Global client sending gate is open; production expects it closed until explicit GO.");
  }
  if (testSendingEnabled) {
    dispatchBlockingReasons.push("Test sending gate is open; production expects it closed.");
  }
  if (lifecycleAutomationEnabled) {
    dispatchBlockingReasons.push("Lifecycle automation gate is open; scheduler is not connected yet.");
  }
  if (needsMoreAutomationEnabled) {
    dispatchBlockingReasons.push("Needs-more automation gate is open; scheduler is not connected yet.");
  }
  if (!lifecycleWatermarkConfigured) {
    dispatchBlockingReasons.push("Lifecycle anti-backfill watermark is not configured.");
  }
  if (!needsMoreWatermarkConfigured) {
    dispatchBlockingReasons.push("Needs-more anti-backfill watermark is not configured.");
  }

  const blockingReasons = [...new Set([
    ...materializationBlockingReasons,
    ...dispatchBlockingReasons,
  ])];

  const schemaReady = intentLinksSchema.available
    && needsMoreSchema.available
    && lifecycleSchema.available
    && deliverySettingsSchema.available
    && emailInfrastructure.available;

  let finalReadinessStatus: ClientEmailLifecycleReadinessStatus = "blocked";
  if (schemaReady && templatesReady && blockingReasons.length === 0) {
    finalReadinessStatus = "ready_for_future_activation";
  } else if (schemaReady && templatesReady) {
    finalReadinessStatus = "partial";
  }

  const materializationReadinessStatus = deriveOutboxLayerReadinessStatus({
    schemaReady,
    templatesReady,
    blockingReasons: materializationBlockingReasons,
  });
  const dispatchReadinessStatus = deriveOutboxLayerReadinessStatus({
    schemaReady,
    templatesReady,
    blockingReasons: dispatchBlockingReasons,
  });

  return {
    readOnly: true,
    schemaIntentLinksReady: intentLinksSchema.available,
    needsMoreSchemaReady: needsMoreSchema.available,
    lifecycleSchemaReady: lifecycleSchema.available,
    templatesReady,
    transactionalSettingsReady: deliverySettingsSchema.available,
    senderConfigured,
    supportEmailConfigured,
    globalSendingEnabled: providerEnv.sendingEnabled,
    testSendingEnabled,
    needsMoreAutomationEnabled,
    lifecycleAutomationEnabled,
    lifecycleWatermarkConfigured,
    needsMoreWatermarkConfigured,
    schedulerConnected: false,
    providerDispatchAllowed: sendingGate.allowed,
    materializationReadinessStatus,
    dispatchReadinessStatus,
    materializationBlockingReasons,
    dispatchBlockingReasons,
    finalReadinessStatus,
    blockingReasons,
  };
}
