import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { logCheckoutActivation } from "./checkout-activation-log.ts";
import {
  inspectSimulatedCheckoutProvisioning,
  type IncompleteCheckoutBlockReason,
} from "./checkout-provisioning-state.ts";

export type ResumeBlockReason =
  | IncompleteCheckoutBlockReason
  | "password_verification_failed"
  | "auth_user_mismatch"
  | "auth_user_not_found";

function mapBlockReasonToCode(reason: ResumeBlockReason) {
  if (reason === "password_verification_failed") return "password_verification_failed" as const;
  if (reason === "checkout_already_complete") return "existing_workspace_use_choose_plan" as const;
  return "auth_user_exists_no_workspace" as const;
}

type PasswordProofInput = {
  email: string;
  password: string;
  expectedAuthUserId: string;
};

type PasswordProofResult =
  | { ok: true; authUserId: string }
  | { ok: false; reason: "password_verification_failed" | "auth_user_mismatch" | "storage_error" };

let passwordProofOverride: ((input: PasswordProofInput) => Promise<PasswordProofResult>) | null = null;

export function setCheckoutPasswordProofOverrideForTests(
  override: ((input: PasswordProofInput) => Promise<PasswordProofResult>) | null,
) {
  passwordProofOverride = override;
}

export async function verifyPurchaserPasswordControl(input: PasswordProofInput): Promise<PasswordProofResult> {
  if (passwordProofOverride) {
    return passwordProofOverride(input);
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false as const, reason: "storage_error" as const };
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({
    email: input.email.trim().toLowerCase(),
    password: input.password,
  });

  // Never retain tokens from password proof — discard session immediately.
  if (data.session) {
    await authClient.auth.signOut();
  }

  if (error || !data.user?.id) {
    return { ok: false as const, reason: "password_verification_failed" as const };
  }
  if (data.user.id !== input.expectedAuthUserId) {
    return { ok: false as const, reason: "auth_user_mismatch" as const };
  }
  return { ok: true as const, authUserId: data.user.id };
}

export async function resolveIncompleteCheckoutResume(
  supabase: SupabaseClient,
  input: {
    email: string;
    authUserId: string;
    password: string;
    idempotencyKey: string;
  },
) {
  logCheckoutActivation({
    event: "checkout_orphan_resume_started",
    idempotencyKey: input.idempotencyKey,
    authUserId: input.authUserId,
    stage: "provisioning_inspection",
  });

  const passwordProof = await verifyPurchaserPasswordControl({
    email: input.email,
    password: input.password,
    expectedAuthUserId: input.authUserId,
  });
  if (!passwordProof.ok) {
    logCheckoutActivation({
      event: "checkout_orphan_resume_blocked",
      idempotencyKey: input.idempotencyKey,
      authUserId: input.authUserId,
      reason: passwordProof.reason,
      stage: "password_verification",
    });
    return {
      ok: false as const,
      code: mapBlockReasonToCode(passwordProof.reason),
      blockReason: passwordProof.reason,
    };
  }

  const inspection = await inspectSimulatedCheckoutProvisioning(supabase, {
    email: input.email,
    authUserId: input.authUserId,
  });

  if (!inspection.ok) {
    logCheckoutActivation({
      event: "checkout_orphan_resume_blocked",
      idempotencyKey: input.idempotencyKey,
      authUserId: input.authUserId,
      reason: inspection.reason,
      stage: "provisioning_inspection",
      postgresCode: inspection.postgresCode,
      storageQuery: inspection.storageQuery,
      storageMessage: inspection.storageMessage,
    });
    return {
      ok: false as const,
      code: inspection.reason === "storage_error"
        ? "checkout_storage_unavailable" as const
        : mapBlockReasonToCode(inspection.reason),
      blockReason: inspection.reason,
    };
  }

  logCheckoutActivation({
    event: "checkout_orphan_resume_completed",
    idempotencyKey: input.idempotencyKey,
    authUserId: input.authUserId,
    clientId: inspection.clientId,
    stage: inspection.resumeMode,
    resumedOrphan: true,
  });

  return {
    ok: true as const,
    authUserId: inspection.authUserId,
    resumeClientId: inspection.clientId,
    resumeMode: inspection.resumeMode,
    existingCheckoutSessionId: inspection.checkoutSessionId,
    existingEntitlementId: inspection.entitlementId,
    stages: inspection.stages,
    createdAuth: false,
    createdClient: false,
    resumedOrphan: true,
  };
}

/** @deprecated import from checkout-provisioning-state */
export { isSimulatedCheckoutClientMetadata } from "./checkout-provisioning-state.ts";

/** @deprecated use resolveIncompleteCheckoutResume */
export async function resolveOrphanResumeCandidate(
  supabase: SupabaseClient,
  input: {
    email: string;
    authUserId: string;
    password: string;
    idempotencyKey: string;
  },
) {
  const result = await resolveIncompleteCheckoutResume(supabase, input);
  if (!result.ok) {
    return {
      ok: false as const,
      code: result.code === "existing_workspace_use_choose_plan"
        ? "auth_user_exists_no_workspace" as const
        : result.code,
    };
  }
  return {
    ok: true as const,
    authUserId: result.authUserId,
    orphanClientId: result.resumeClientId,
    createdAuth: false,
    createdClient: false,
    resumedOrphan: true,
  };
}
