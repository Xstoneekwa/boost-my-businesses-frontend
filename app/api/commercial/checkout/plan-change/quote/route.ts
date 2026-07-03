import { jsonError, jsonOk, readJsonBody } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { createPlanChangeQuote } from "@/lib/commercial/plan-change-quote";
import { loadPlanChangeSourceForAccount, clientVisiblePlanLabel } from "@/lib/commercial/plan-change-source";
import { requireClientInstagramSession, readString } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

type QuoteBody = {
  target_plan_key?: unknown;
  idempotency_key?: unknown;
  account_id?: unknown;
  source_entitlement_id?: unknown;
  client_id?: unknown;
  amount_due_cents?: unknown;
};

export async function POST(request: Request) {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return jsonError("Connexion client requise.", 401, {
      code: "session_required",
      message_fr: "Connexion client requise.",
      message_en: "Client login is required.",
    });
  }

  let body: QuoteBody | null;
  try {
    body = await readJsonBody<QuoteBody>(request);
  } catch {
    return jsonError("Corps JSON invalide.", 400, {
      code: "invalid_json",
      message_fr: "Corps JSON invalide.",
      message_en: "Invalid JSON body.",
    });
  }

  if (!body) {
    return jsonError("Corps JSON invalide.", 400, {
      code: "invalid_json",
      message_fr: "Corps JSON invalide.",
      message_en: "Invalid JSON body.",
    });
  }

  if (readString(body.client_id)) {
    return jsonError("Requête invalide.", 400, {
      code: "client_id_not_allowed",
      message_fr: "Requête invalide.",
      message_en: "Invalid request.",
    });
  }

  if (body.amount_due_cents != null) {
    return jsonError("Requête invalide.", 400, {
      code: "client_amount_not_allowed",
      message_fr: "Les montants doivent être recalculés côté serveur.",
      message_en: "Amounts must be recalculated server-side.",
    });
  }

  const accountId = readString(body.account_id);
  if (!accountId) {
    return jsonError("Compte Instagram requis.", 400, {
      code: "account_required",
      message_fr: "Sélectionnez le compte Instagram à modifier.",
      message_en: "Select the Instagram account to change.",
    });
  }

  const targetPlanKey = readString(body.target_plan_key);
  const idempotencyKey = readString(body.idempotency_key) || crypto.randomUUID();
  const sourceEntitlementId = readString(body.source_entitlement_id) || null;
  const supabase = createSupabaseClient();

  const sourcePreview = await loadPlanChangeSourceForAccount(supabase, {
    clientId: session.clientId,
    accountId,
    sourceEntitlementId,
  });
  const result = await createPlanChangeQuote(supabase, {
    clientId: session.clientId,
    accountId,
    sourceEntitlementId,
    targetPlanKey,
    idempotencyKey,
  });

  if (!result.ok) {
    return jsonError(result.messageFr, result.status, {
      code: result.code,
      message_fr: result.messageFr,
      message_en: result.messageEn,
    });
  }

  return jsonOk({
    quote: result.quote,
    checkout_context: "per_account_plan_change",
    current_plan: sourcePreview.ok
      ? {
        account_id: sourcePreview.source.accountId,
        plan_key: sourcePreview.source.currentPlanKey,
        label: clientVisiblePlanLabel(sourcePreview.source.currentPlanKey),
        period_end_at: sourcePreview.source.periodEndAt,
        billing_interval_months: sourcePreview.source.billingIntervalMonths,
      }
      : null,
  });
}
