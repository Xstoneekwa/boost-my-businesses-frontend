import { resolveClientAccountState } from "./client-account-state";

export type ClientAccountConnectionInput = {
  connected: boolean;
  loginStatus?: string;
  onboardingStatus?: string;
  provisioningStatus?: string;
  assignmentStatus?: string;
  operationPending?: boolean;
};

export type ClientAccountConnectionUi = {
  badgeLabel: string;
  badgeTone: "success" | "warning" | "neutral";
  subtext: string | null;
  readinessLabel: string;
  readinessTone: "success" | "warning" | "neutral";
  readinessDisabled: boolean;
  connectLabel: string;
  connectTone: "success" | "primary" | "neutral";
  connectDisabled: boolean;
  showRefresh: boolean;
  isAsyncPending: boolean;
  phase: ReturnType<typeof resolveClientAccountState>["phase"];
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
  }, lang);
}
