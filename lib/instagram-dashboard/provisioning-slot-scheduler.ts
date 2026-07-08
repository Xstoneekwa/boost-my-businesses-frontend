import {
  CLIENT_PROVISIONING_SLOT_HORIZON_MS,
  CLIENT_PROVISIONING_SLOT_SCAN_STEP_MS,
  CLIENT_PROVISIONING_SLOT_WINDOW_MS,
} from "./client-provisioning-slot-constants.ts";
import { evaluatePhoneIdleForClientConnect } from "./evaluate-phone-idle-for-client-connect.ts";

type SupabaseLike = Parameters<typeof evaluatePhoneIdleForClientConnect>[0];

export type ProvisioningSlotCandidate = {
  windowStartUtc: string;
  windowEndUtc: string;
};

export type FindNextSafeProvisioningSlotInput = {
  accountId: string;
  assignmentId: string;
  deviceId: string;
  appInstanceId: string;
  now?: Date;
};

export type FindNextSafeProvisioningSlotResult =
  | { ok: true; slot: ProvisioningSlotCandidate }
  | { ok: false; reason: string };

function alignToNextStep(epochMs: number, stepMs: number) {
  return Math.ceil(epochMs / stepMs) * stepMs;
}

export async function findNextSafeProvisioningSlot(
  supabase: SupabaseLike,
  input: FindNextSafeProvisioningSlotInput,
): Promise<FindNextSafeProvisioningSlotResult> {
  const now = input.now ?? new Date();
  const horizonEnd = now.getTime() + CLIENT_PROVISIONING_SLOT_HORIZON_MS;
  let cursor = alignToNextStep(now.getTime(), CLIENT_PROVISIONING_SLOT_SCAN_STEP_MS);

  while (cursor + CLIENT_PROVISIONING_SLOT_WINDOW_MS <= horizonEnd) {
    const windowStartUtc = new Date(cursor).toISOString();
    const windowEndUtc = new Date(cursor + CLIENT_PROVISIONING_SLOT_WINDOW_MS).toISOString();
    const evaluation = await evaluatePhoneIdleForClientConnect(supabase, {
      accountId: input.accountId,
      assignmentId: input.assignmentId,
      deviceId: input.deviceId,
      appInstanceId: input.appInstanceId,
      now: new Date(cursor),
      windowStart: windowStartUtc,
      windowEnd: windowEndUtc,
    });
    if (evaluation.idle) {
      return {
        ok: true,
        slot: { windowStartUtc, windowEndUtc },
      };
    }
    cursor += CLIENT_PROVISIONING_SLOT_SCAN_STEP_MS;
  }

  return { ok: false, reason: "no_safe_provisioning_slot_within_horizon" };
}
