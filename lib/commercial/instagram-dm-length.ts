export const INSTAGRAM_DM_TARGET_LIMIT = 900;
export const INSTAGRAM_DM_HARD_LIMIT = 1000;
export const INSTAGRAM_DM_LENGTH_GUARD = "INSTAGRAM_DM_LENGTH_GUARD";
export const INSTAGRAM_DM_CONDENSE = "INSTAGRAM_DM_OVER_TARGET_CONDENSE";

/** Exact final plain-text payload, not normalized, trimmed, or grapheme-counted.
 * JavaScript UTF-16 units: spaces/newlines/URLs/signatures and emoji surrogates count.
 * The persisted body IS the final payload; any future suffix must be added BEFORE this guard.
 */
export function instagramDmLengthGuard(finalPayload: string) {
  const character_count = finalPayload.length;
  const limit_status = character_count >= INSTAGRAM_DM_HARD_LIMIT ? "HARD_LIMIT_EXCEEDED"
    : character_count > INSTAGRAM_DM_TARGET_LIMIT ? "OVER_TARGET" : "WITHIN_TARGET";
  return { character_count, limit_status };
}

/** Use the durable claim's existing attempt budget; never spawn an inner retry loop. */
export function instagramDmGenerationLengthCode(finalPayload: string, attempt: number, maxAttempts: number) {
  const { limit_status } = instagramDmLengthGuard(finalPayload);
  if (limit_status === "HARD_LIMIT_EXCEEDED") return INSTAGRAM_DM_LENGTH_GUARD;
  if (limit_status === "OVER_TARGET" && attempt < maxAttempts) return INSTAGRAM_DM_CONDENSE;
  return null;
}
