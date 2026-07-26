export const ACCOUNT_PROTECTION_LIST_VALIDATOR_HEADER = "x-account-protection-list-validator";

export function readAccountProtectionListValidator(headers: Headers) {
  return headers.get(ACCOUNT_PROTECTION_LIST_VALIDATOR_HEADER) ?? headers.get("etag") ?? "";
}
