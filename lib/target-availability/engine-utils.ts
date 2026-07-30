import { createHash } from "node:crypto";
import type { AvailabilityObservation, AvailabilityScope, EngineEvent } from "./engine-types.ts";

export const normalizeUsername = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/^@+/, "").toLowerCase();

export const validUsername = (value: string) => /^[a-z0-9._]{1,30}$/.test(value);

export const timestamp = (value: string) => {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : Number.NaN;
};

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
};

export const deterministicUuid = (value: unknown) => {
  const hex = createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
};

export const sameScope = (scope: AvailabilityScope, value: AvailabilityScope) =>
  Boolean(scope.tenantId && scope.accountId && scope.targetId)
  && scope.tenantId === value.tenantId
  && scope.accountId === value.accountId
  && scope.targetId === value.targetId;

export const event = (
  scope: AvailabilityScope,
  type: EngineEvent["type"],
  occurredAt: string,
  reason: string,
  subjectId?: string | null,
): EngineEvent => Object.freeze({ ...scope, type, occurredAt, reason, subjectId });

export function orderAndValidateObservations(scope: AvailabilityScope, rows: readonly AvailabilityObservation[]) {
  const rejected: Array<{ observationId: string; reason: string }> = [];
  const duplicateIds: string[] = [];
  const seen = new Set<string>();
  const accepted = [...rows].sort((left, right) =>
    timestamp(left.observedAt) - timestamp(right.observedAt)
    || left.observationId.localeCompare(right.observationId));
  const valid = accepted.filter((row) => {
    if (!sameScope(scope, row)) {
      rejected.push({ observationId: row.observationId || "missing", reason: "scope_mismatch" });
      return false;
    }
    if (!row.observationId || !row.idempotencyKey || !Number.isFinite(timestamp(row.observedAt))) {
      rejected.push({ observationId: row.observationId || "missing", reason: "partial_or_invalid_observation" });
      return false;
    }
    const expected = normalizeUsername(row.expectedUsername);
    const observed = normalizeUsername(row.observedUsername);
    if (!validUsername(expected) || (observed && !validUsername(observed))) {
      rejected.push({ observationId: row.observationId, reason: "invalid_username" });
      return false;
    }
    if (seen.has(row.idempotencyKey)) {
      duplicateIds.push(row.observationId);
      return false;
    }
    seen.add(row.idempotencyKey);
    return true;
  });
  return Object.freeze({
    accepted: Object.freeze(valid),
    rejected: Object.freeze(rejected),
    duplicateIds: Object.freeze(duplicateIds),
  });
}
