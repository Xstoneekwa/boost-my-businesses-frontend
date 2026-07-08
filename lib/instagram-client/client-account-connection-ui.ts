import { resolveClientAccountState, type ClientAccountStateUi } from "./client-account-state";

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

export type ClientAccountConnectionUi = ClientAccountStateUi;

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
