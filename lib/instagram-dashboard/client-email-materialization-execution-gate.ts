export const CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV = "CLIENT_EMAIL_MATERIALIZE_ENABLED" as const;

export type ClientEmailMaterializationExecutionGateReason =
  | "enabled"
  | "unset"
  | "not_true";

export type ClientEmailMaterializationExecutionGateProjection = {
  enabled: boolean;
  reason: ClientEmailMaterializationExecutionGateReason;
};

export function evaluateClientEmailMaterializationExecutionGate(
  env: Record<string, string | undefined> = process.env,
): ClientEmailMaterializationExecutionGateProjection {
  const raw = env[CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV];
  if (raw == null || raw.trim() === "") {
    return { enabled: false, reason: "unset" };
  }
  if (raw.trim() === "true") {
    return { enabled: true, reason: "enabled" };
  }
  return { enabled: false, reason: "not_true" };
}
