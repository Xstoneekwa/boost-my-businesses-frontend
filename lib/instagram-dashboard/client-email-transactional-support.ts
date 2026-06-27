import { CLIENT_EMAIL_LOCKED_FROM } from "./client-email-constants.ts";
import type { ResolvedTransactionalDeliverySettings } from "./client-email-delivery-settings.ts";

export const CLIENT_EMAIL_TRANSACTIONAL_SUPPORT_EMAIL = CLIENT_EMAIL_LOCKED_FROM;

export function resolveClientEmailTransactionalSupportEmail(
  settings?: Pick<ResolvedTransactionalDeliverySettings, "supportEmail">,
): string {
  return settings?.supportEmail ?? CLIENT_EMAIL_LOCKED_FROM;
}
