import { NextResponse } from "next/server";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { isClientAiTargetingEnabled } from "@/lib/instagram-client/ai-targeting-gate";
import { resolveAccountPackageCode } from "@/lib/instagram-client/resolve-account-package-code";
import { isTargetAiConfigured, readTargetAiConfigStatus, safeTargetAiLog, type TargetAiErrorCode } from "@/lib/instagram-client/target-ai-config";
import { targetAiErrorMessage } from "@/lib/instagram-client/target-ai-errors";

export async function authorizeClientTargetAiRoute(accountId: string, options?: { requireAiConfig?: boolean }) {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return {
      error: jsonTargetAiError("ownership_denied", 401, "en", session.error),
    };
  }

  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) {
    return { error: jsonTargetAiError("ownership_denied", 400, "en", "Missing account id.") };
  }

  const ownership = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
  if (!ownership.ok) {
    return { error: jsonTargetAiError("ownership_denied", ownership.status, "en", ownership.error) };
  }

  const packageCode = await resolveAccountPackageCode(normalizedAccountId);
  if (!isClientAiTargetingEnabled(packageCode)) {
    safeTargetAiLog("plan_not_allowed", {
      account_id: normalizedAccountId,
      package_code: packageCode,
    });
    return { error: jsonTargetAiError("plan_not_allowed", 403, "en") };
  }

  if (options?.requireAiConfig !== false) {
    const configStatus = readTargetAiConfigStatus();
    if (configStatus !== "ready") {
      safeTargetAiLog("target_ai_config_missing", {
        account_id: normalizedAccountId,
        package_code: packageCode,
        config_status: configStatus,
        target_ai_enabled: process.env.TARGET_AI_ENABLED === "true",
        provider_present: Boolean(process.env.OPENAI_API_KEY?.trim()),
      });
      return { error: jsonTargetAiError(configStatus, 503, "en") };
    }
  }

  return {
    accountId: normalizedAccountId,
    packageCode,
    aiConfigured: isTargetAiConfigured(),
  };
}

export function jsonTargetAiError(code: TargetAiErrorCode, status: number, lang: "fr" | "en" = "en", overrideMessage?: string) {
  return NextResponse.json({
    ok: false,
    error_code: code,
    error: overrideMessage || targetAiErrorMessage(lang, code),
  }, { status });
}
