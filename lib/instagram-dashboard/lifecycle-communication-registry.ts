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
