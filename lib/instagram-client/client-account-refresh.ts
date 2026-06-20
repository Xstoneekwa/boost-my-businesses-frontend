import { loadClientInstagramAccount } from "./load-client-instagram-accounts";
import {
  operationPendingFromConnectResult,
  operationPendingFromReadinessResult,
} from "./client-account-state";

export async function reloadClientAccountSnapshot(input: {
  clientId: string;
  accountId: string;
}) {
  return loadClientInstagramAccount(input.clientId, input.accountId);
}

export function attachOperationPending<T extends Record<string, unknown>>(
  account: Awaited<ReturnType<typeof reloadClientAccountSnapshot>>,
  action: "connect" | "readiness",
  result: T,
) {
  if (!account) return null;
  const operationPending = action === "connect"
    ? operationPendingFromConnectResult(result as { request_queued?: boolean; status?: string; connected?: boolean })
    : operationPendingFromReadinessResult(result as { status?: string; connected?: boolean });
  return {
    ...account,
    operationPending,
  } as typeof account & { operationPending: boolean };
}
