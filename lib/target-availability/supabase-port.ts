import type { SupabaseClient } from "@supabase/supabase-js";
import type { AvailabilityScope, CurrentPointer, TargetAvailabilityPersistencePort } from "./writer.ts";

const message = (error: { message?: string } | null) => error?.message ?? "target_availability_persistence_failed";

export class SupabaseTargetAvailabilityPersistencePort implements TargetAvailabilityPersistencePort {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient, credentialRole: "service_role") {
    if (credentialRole !== "service_role") throw new Error("target_availability_service_role_required");
    this.client = client;
  }

  private scoped(table: string, scope: AvailabilityScope) {
    return this.client.from(table).select("*").eq("tenant_id", scope.tenantId).eq("account_id", scope.accountId).eq("target_id", scope.targetId);
  }

  private async insertIdempotent(table: string, row: Readonly<Record<string, unknown>>, keyColumn: string, key: string, conflict: string) {
    const result = await this.client.from(table).upsert(row, { onConflict: conflict, ignoreDuplicates: true }).select("id").maybeSingle();
    if (result.error) throw new Error(message(result.error));
    if (result.data?.id) return String(result.data.id);
    let foundQuery = this.client.from(table).select("id").eq("tenant_id", row.tenant_id).eq("account_id", row.account_id).eq(keyColumn, key);
    if (conflict.includes("target_id")) foundQuery = foundQuery.eq("target_id", row.target_id);
    const found = await foundQuery.maybeSingle();
    if (found.error || !found.data?.id) throw new Error(message(found.error));
    return String(found.data.id);
  }

  insertIdentityHistory(row: Readonly<Record<string, unknown>>) {
    return this.insertIdempotent("ct_target_identity_history", row, "idempotency_key", String(row.idempotency_key), "tenant_id,account_id,idempotency_key");
  }

  async readIdentityCurrent(scope: AvailabilityScope): Promise<CurrentPointer | null> {
    const result = await this.scoped("ct_target_identity_current", scope).maybeSingle();
    if (result.error) throw new Error(message(result.error));
    return result.data ? { recordId: String(result.data.last_history_id), observedAt: String(result.data.last_observed_at) } : null;
  }

  async insertIdentityCurrent(row: Readonly<Record<string, unknown>>) {
    const result = await this.client.from("ct_target_identity_current").upsert(row, { onConflict: "tenant_id,account_id,target_id", ignoreDuplicates: true }).select("last_history_id").maybeSingle();
    if (result.error) throw new Error(message(result.error));
    return Boolean(result.data);
  }

  async compareAndSwapIdentityCurrent(scope: AvailabilityScope, expectedHistoryId: string, row: Readonly<Record<string, unknown>>) {
    const result = await this.client.from("ct_target_identity_current").update(row).eq("tenant_id", scope.tenantId).eq("account_id", scope.accountId).eq("target_id", scope.targetId).eq("last_history_id", expectedHistoryId).select("last_history_id").maybeSingle();
    if (result.error) throw new Error(message(result.error));
    return Boolean(result.data);
  }

  insertAssessment(row: Readonly<Record<string, unknown>>) {
    return this.insertIdempotent("ct_target_availability_assessments", row, "assessment_key", String(row.assessment_key), "tenant_id,account_id,target_id,assessment_key");
  }

  async readAssessmentCurrent(scope: AvailabilityScope): Promise<CurrentPointer | null> {
    const current = await this.scoped("ct_target_availability_current", scope).maybeSingle();
    if (current.error) throw new Error(message(current.error));
    if (!current.data) return null;
    const assessment = await this.client.from("ct_target_availability_assessments").select("assessed_at").eq("id", current.data.assessment_id).maybeSingle();
    if (assessment.error || !assessment.data) throw new Error(message(assessment.error));
    return { recordId: String(current.data.assessment_id), observedAt: String(assessment.data.assessed_at) };
  }

  async insertAssessmentCurrent(row: Readonly<Record<string, unknown>>) {
    const result = await this.client.from("ct_target_availability_current").upsert(row, { onConflict: "tenant_id,account_id,target_id", ignoreDuplicates: true }).select("assessment_id").maybeSingle();
    if (result.error) throw new Error(message(result.error));
    return Boolean(result.data);
  }

  async compareAndSwapAssessmentCurrent(scope: AvailabilityScope, expectedAssessmentId: string, row: Readonly<Record<string, unknown>>) {
    const result = await this.client.from("ct_target_availability_current").update(row).eq("tenant_id", scope.tenantId).eq("account_id", scope.accountId).eq("target_id", scope.targetId).eq("assessment_id", expectedAssessmentId).select("assessment_id").maybeSingle();
    if (result.error) throw new Error(message(result.error));
    return Boolean(result.data);
  }
}
