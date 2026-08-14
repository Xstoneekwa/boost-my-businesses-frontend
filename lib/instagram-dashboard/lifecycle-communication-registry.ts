export type LifecycleCommunicationKey =
  | "account_paused"
  | "account_resumed"
  | "account_cancelled"
  | "needs_assistance"
  | "operator_review_required"
  | "login_required"
  | "identity_verification_required"
  | "needs_more_target_accounts"
  | "target_replacement_required"
  | "target_removed";

export type LifecycleLocale = "fr" | "en";

export type LifecyclePrimaryStatus =
  | "cancelled"
  | "paused"
  | "operator_review_required"
  | "needs_assistance"
  | "login_required"
  | "identity_verification_required"
  | "readiness"
  | "active";

export type AccountLifecycleActionKey = "pause" | "cancel" | "mark_needs_assistance" | "reactivate";

export type AccountLifecycleActionMatrixState = "active" | "paused" | "cancelled";

export const LIFECYCLE_STATUS_PRIORITY: readonly LifecyclePrimaryStatus[] = [
  "cancelled",
  "paused",
  "operator_review_required",
  "needs_assistance",
  "login_required",
  "identity_verification_required",
  "readiness",
  "active",
];

export const ACCOUNT_LIFECYCLE_ACTION_MATRIX: Readonly<
  Record<AccountLifecycleActionMatrixState, Readonly<Record<AccountLifecycleActionKey, boolean>>>
> = {
  active: { pause: true, cancel: true, mark_needs_assistance: true, reactivate: false },
  paused: { pause: false, cancel: true, mark_needs_assistance: true, reactivate: true },
  cancelled: { pause: false, cancel: false, mark_needs_assistance: false, reactivate: false },
};

type LifecycleActionCopy = {
  label: string;
  description: string;
  alreadyActive: string;
  disabledForState: string;
};

export const LIFECYCLE_ACTION_COPY: Readonly<
  Record<LifecycleLocale, Readonly<Record<AccountLifecycleActionKey, LifecycleActionCopy>>>
> = {
  en: {
    pause: {
      label: "Pause campaign",
      description: "Pause billing and campaign activity. The slot and clone stay reserved.",
      alreadyActive: "The account is already paused.",
      disabledForState: "This account cannot be paused from its current lifecycle state.",
    },
    cancel: {
      label: "Cancel account service",
      description: "Cancel Stripe billing, close the entitlement, and release the slot when runtime is terminal.",
      alreadyActive: "The account service is already inactive.",
      disabledForState: "This account cannot be cancelled from its current lifecycle state.",
    },
    mark_needs_assistance: {
      label: "Mark as needs assistance",
      description: "Block business runs while keeping the assignment reserved for support review.",
      alreadyActive: "The account already needs assistance.",
      disabledForState: "This account cannot be marked for assistance from its current lifecycle state.",
    },
    reactivate: {
      label: "Resume campaign",
      description: "Resume Stripe billing and campaign eligibility when all canonical blockers are resolved.",
      alreadyActive: "The account is already active.",
      disabledForState: "Only a paused account can be resumed.",
    },
  },
  fr: {
    pause: {
      label: "Suspendre la campagne",
      description: "Suspend la facturation et les actions de campagne. Le créneau et le clone restent réservés.",
      alreadyActive: "Le compte est déjà en pause.",
      disabledForState: "Ce compte ne peut pas être mis en pause depuis son état actuel.",
    },
    cancel: {
      label: "Résilier le service du compte",
      description: "Résilie la facturation Stripe, clôture le droit et libère le créneau lorsque le runtime est terminal.",
      alreadyActive: "Le service du compte est déjà inactif.",
      disabledForState: "Ce compte ne peut pas être résilié depuis son état actuel.",
    },
    mark_needs_assistance: {
      label: "Marquer comme nécessitant une assistance",
      description: "Bloque les runs métier tout en conservant l’assignation pour la revue du support.",
      alreadyActive: "Le compte nécessite déjà une assistance.",
      disabledForState: "Ce compte ne peut pas être placé en assistance depuis son état actuel.",
    },
    reactivate: {
      label: "Reprendre la campagne",
      description: "Reprend la facturation Stripe et l’éligibilité de campagne lorsque tous les blocages canoniques sont résolus.",
      alreadyActive: "Le compte est déjà actif.",
      disabledForState: "Seul un compte en pause peut être repris.",
    },
  },
};

export const LIFECYCLE_STATUS_COPY: Readonly<
  Record<LifecycleCommunicationKey, Readonly<Record<LifecycleLocale, string>>>
> = {
  account_paused: { en: "Account paused", fr: "Compte en pause" },
  account_resumed: { en: "Account active", fr: "Compte actif" },
  account_cancelled: { en: "Account cancelled", fr: "Compte résilié" },
  needs_assistance: { en: "Needs assistance", fr: "Assistance requise" },
  operator_review_required: { en: "Operator review required", fr: "Revue opérateur requise" },
  login_required: { en: "Instagram login required", fr: "Connexion Instagram requise" },
  identity_verification_required: { en: "Identity verification required", fr: "Vérification d’identité requise" },
  needs_more_target_accounts: { en: "More target accounts needed", fr: "Ajoutez des comptes cibles" },
  target_replacement_required: { en: "Target replacement required", fr: "Remplacement de cible requis" },
  target_removed: { en: "Target account removed", fr: "Compte cible retiré" },
};

export function resolveLifecyclePrimaryStatus(input: {
  cancelled?: boolean;
  paused?: boolean;
  operatorReviewRequired?: boolean;
  needsAssistance?: boolean;
  loginRequired?: boolean;
  identityVerificationRequired?: boolean;
  readinessStatus?: string | null;
}): LifecyclePrimaryStatus {
  if (input.cancelled) return "cancelled";
  if (input.paused) return "paused";
  if (input.operatorReviewRequired) return "operator_review_required";
  if (input.needsAssistance) return "needs_assistance";
  if (input.loginRequired) return "login_required";
  if (input.identityVerificationRequired) return "identity_verification_required";
  if (input.readinessStatus && input.readinessStatus !== "ready") return "readiness";
  return "active";
}

export function lifecycleActionCopy(locale: LifecycleLocale, action: AccountLifecycleActionKey) {
  return LIFECYCLE_ACTION_COPY[locale][action];
}

export function projectCommercialLifecyclePresentation(
  accountStatus: string | null | undefined,
  locale: LifecycleLocale,
): { status: "paused" | "cancelled"; label: string; tone: "warning" | "danger" } | null {
  const normalized = String(accountStatus ?? "").trim().toLowerCase();
  if (normalized === "paused") {
    return {
      status: "paused",
      label: LIFECYCLE_STATUS_COPY.account_paused[locale],
      tone: "warning",
    };
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return {
      status: "cancelled",
      label: LIFECYCLE_STATUS_COPY.account_cancelled[locale],
      tone: "danger",
    };
  }
  return null;
}

export type LifecycleCommunicationPolicy = {
  primaryUiStatus: string;
  clientWording: string;
  adminWording: string;
  botAppWording: string;
  email: {
    required: boolean;
    templateCategory: "account_paused" | "account_canceled" | "needs_assistance" | "needs_more_target_accounts" | null;
    historyCategory: string | null;
  };
  slackDiscord: "existing_incident_policy" | "none";
  operatorAction: "required" | "optional" | "none";
  schedulerRuntimeEffect: "blocked" | "unchanged" | "recompute";
};

export const LIFECYCLE_COMMUNICATION_REGISTRY: Readonly<Record<LifecycleCommunicationKey, LifecycleCommunicationPolicy>> = {
  account_paused: {
    primaryUiStatus: "paused",
    clientWording: "Compte en pause",
    adminWording: "Pause commerciale active",
    botAppWording: "paused",
    email: { required: true, templateCategory: "account_paused", historyCategory: "account_paused" },
    slackDiscord: "none",
    operatorAction: "none",
    schedulerRuntimeEffect: "blocked",
  },
  account_resumed: {
    primaryUiStatus: "active",
    clientWording: "Compte actif",
    adminWording: "Cycle commercial actif",
    botAppWording: "active",
    email: { required: false, templateCategory: null, historyCategory: null },
    slackDiscord: "none",
    operatorAction: "none",
    schedulerRuntimeEffect: "recompute",
  },
  account_cancelled: {
    primaryUiStatus: "cancelled",
    clientWording: "Compte annulé",
    adminWording: "Contrat commercial annulé",
    botAppWording: "cancelled",
    email: { required: true, templateCategory: "account_canceled", historyCategory: "account_canceled" },
    slackDiscord: "none",
    operatorAction: "none",
    schedulerRuntimeEffect: "blocked",
  },
  needs_assistance: {
    primaryUiStatus: "needs_assistance",
    clientWording: "Assistance requise",
    adminWording: "Assistance client requise",
    botAppWording: "needs assistance",
    email: { required: true, templateCategory: "needs_assistance", historyCategory: "needs_assistance" },
    slackDiscord: "existing_incident_policy",
    operatorAction: "required",
    schedulerRuntimeEffect: "blocked",
  },
  operator_review_required: {
    primaryUiStatus: "operator_review_required",
    clientWording: "Vérification en cours",
    adminWording: "Revue opérateur requise",
    botAppWording: "operator review",
    email: { required: false, templateCategory: null, historyCategory: null },
    slackDiscord: "existing_incident_policy",
    operatorAction: "required",
    schedulerRuntimeEffect: "blocked",
  },
  login_required: {
    primaryUiStatus: "login_required",
    clientWording: "Connexion Instagram requise",
    adminWording: "Login requis",
    botAppWording: "login required",
    email: { required: false, templateCategory: null, historyCategory: null },
    slackDiscord: "existing_incident_policy",
    operatorAction: "optional",
    schedulerRuntimeEffect: "blocked",
  },
  identity_verification_required: {
    primaryUiStatus: "identity_verification_required",
    clientWording: "Vérification d'identité requise",
    adminWording: "Identity Guard requis",
    botAppWording: "identity verification required",
    email: { required: false, templateCategory: null, historyCategory: null },
    slackDiscord: "existing_incident_policy",
    operatorAction: "required",
    schedulerRuntimeEffect: "blocked",
  },
  needs_more_target_accounts: {
    primaryUiStatus: "needs_more_target_accounts",
    clientWording: "Ajoutez des comptes cibles",
    adminWording: "Stock de comptes cibles au seuil opérationnel",
    botAppWording: "needs more targets",
    email: { required: true, templateCategory: "needs_more_target_accounts", historyCategory: "needs_more_target_accounts" },
    slackDiscord: "existing_incident_policy",
    operatorAction: "optional",
    schedulerRuntimeEffect: "unchanged",
  },
  target_replacement_required: {
    primaryUiStatus: "target_replacement_required",
    clientWording: "Remplacement de cible requis",
    adminWording: "Target replacement required",
    botAppWording: "target replacement required",
    email: { required: false, templateCategory: null, historyCategory: null },
    slackDiscord: "existing_incident_policy",
    operatorAction: "optional",
    schedulerRuntimeEffect: "unchanged",
  },
  target_removed: {
    primaryUiStatus: "target_removed",
    clientWording: "Compte cible retiré",
    adminWording: "Target removed",
    botAppWording: "target removed",
    email: { required: false, templateCategory: null, historyCategory: null },
    slackDiscord: "none",
    operatorAction: "none",
    schedulerRuntimeEffect: "unchanged",
  },
};

export function lifecycleCommunicationPolicy(key: LifecycleCommunicationKey) {
  return LIFECYCLE_COMMUNICATION_REGISTRY[key];
}
