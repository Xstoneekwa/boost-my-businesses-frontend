export type CommercialLifecycleState =
  | "active"
  | "pause_requested"
  | "paused"
  | "resume_requested"
  | "cancel_requested"
  | "cancelled"
  | "action_required";

export type CommercialLifecycleOperationType = "pause" | "resume" | "cancel";

export type CommercialLifecycleOperationState = "pending" | "in_progress" | "completed" | "failed";

export type CommercialLifecycleActor = {
  actorType: "admin" | "botapp" | "system" | "cron";
  actorId: string | null;
  sourceSurface: string;
};

export type CommercialLifecycleStateRow = {
  accountId: string;
  entitlementId: string | null;
  stripeSubscriptionId: string | null;
  commercialState: CommercialLifecycleState;
  pauseExpiresAt: string | null;
  pausedAt: string | null;
  stripeBillingPaused: boolean;
  actionRequiredReason: string | null;
  lastOperationId: string | null;
  lastIdempotencyKey: string | null;
};

export type CommercialLifecycleResult = {
  ok: boolean;
  accountId: string;
  operationType: CommercialLifecycleOperationType;
  commercialState: CommercialLifecycleState;
  idempotencyKey: string;
  operationId: string | null;
  converged: boolean;
  actionRequired: boolean;
  actionRequiredReason: string | null;
  pauseExpiresAt: string | null;
  stripeBillingPaused: boolean;
  capacityReleaseStatus: "not_applicable" | "released" | "pending" | "skipped_active_runtime";
  runtimeQuiesced: boolean;
};
