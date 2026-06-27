import { CLIENT_EMAIL_LOCKED_FROM } from "./client-email-constants.ts";

export const CLIENT_EMAIL_TRANSACTIONAL_SUPPORT_EMAIL = CLIENT_EMAIL_LOCKED_FROM;

export function resolveClientEmailTransactionalSupportEmail(): typeof CLIENT_EMAIL_TRANSACTIONAL_SUPPORT_EMAIL {
  return CLIENT_EMAIL_TRANSACTIONAL_SUPPORT_EMAIL;
}
