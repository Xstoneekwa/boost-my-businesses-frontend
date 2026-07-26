export const PACKAGE_RUNTIME_BLOCK_REASONS = new Set([
  "assignment_package_mismatch",
  "app_instance_package_mismatch",
  "clone_package_mismatch",
  "package_settings_incomplete",
  "runtime_profile_mismatch",
]);

export type PackageRuntimeContract = Record<string, unknown> & {
  ok: boolean;
  reason: string;
};

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stableReason(value: unknown) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason === "ready") return reason;
  for (const candidate of PACKAGE_RUNTIME_BLOCK_REASONS) {
    if (reason === candidate || reason.includes(candidate)) return candidate;
  }
  return "package_settings_incomplete";
}

export async function loadPackageRuntimeContract(
  supabase: RpcClient,
  accountId: string,
): Promise<PackageRuntimeContract> {
  const { data, error } = await supabase.rpc("account_package_runtime_contract_status", {
    p_account_id: accountId,
  });
  if (error) {
    return { ok: false, reason: "package_settings_incomplete", telemetry: "contract_rpc_failed" };
  }
  const value = record(data);
  const reason = stableReason(value?.reason);
  return {
    ...(value ?? {}),
    ok: value?.ok === true && reason === "ready",
    reason,
  };
}

export async function reconcilePackageRuntimeContract(
  supabase: RpcClient,
  accountId: string,
  source: string,
): Promise<PackageRuntimeContract> {
  const { data, error } = await supabase.rpc("reconcile_account_package_runtime_contract", {
    p_account_id: accountId,
    p_source: source,
  });
  if (error) {
    const reason = stableReason(error.message);
    return { ok: false, reason, telemetry: "contract_reconcile_failed" };
  }
  const value = record(data);
  return {
    ...(value ?? {}),
    ok: value?.ok === true,
    reason: value?.ok === true ? "ready" : stableReason(value?.reason),
  };
}
