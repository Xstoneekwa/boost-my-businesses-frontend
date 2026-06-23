import { resolveClientAccountState } from "./client-account-state";

export type ClientAccountConnectionInput = {
  connected: boolean;
  loginStatus?: string;
  onboardingStatus?: string;
  provisioningStatus?: string;
  assignmentStatus?: string;
  operationPending?: boolean;
  clientReadinessStatus?: string | null;
  activeConnectStatus?: string | null;
};

export type ClientAccountConnectionUi = {
  badgeLabel: string;
  badgeTone: "success" | "warning" | "neutral";
  subtext: string | null;
  readinessLabel: string;
  readinessTone: "success" | "warning" | "neutral";
  readinessDisabled: boolean;
  showRecheckReadiness: boolean;
  recheckReadinessLabel: string;
  connectLabel: string;
  connectTone: "success" | "primary" | "neutral";
  connectDisabled: boolean;
  connectPrimary: boolean;
  showRefresh: boolean;
  isAsyncPending: boolean;
  phase: ReturnType<typeof resolveClientAccountState>["phase"];
  showVerificationReopen: boolean;
  verificationReopenLabel: string;
};

export function resolveClientAccountConnectionUi(
  account: ClientAccountConnectionInput,
  lang: "fr" | "en" = "fr",
): ClientAccountConnectionUi {
  return resolveClientAccountState({
    loginStatus: account.loginStatus,
    onboardingStatus: account.onboardingStatus,
    provisioningStatus: account.provisioningStatus,
    assignmentStatus: account.assignmentStatus,
    connected: account.connected,
    operationPending: account.operationPending,
    clientReadinessStatus: account.clientReadinessStatus,
    activeConnectStatus: account.activeConnectStatus,
  }, lang);
}
