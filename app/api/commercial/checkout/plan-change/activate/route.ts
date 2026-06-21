import { readJsonBody } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { activatePlanChangeQuote } from "@/lib/commercial/plan-change-quote";
import { evaluatePlanChangeActivation, planChangeActivationClientMessages } from "@/lib/commercial/plan-change-activation-guard";
import {
  checkoutActivationError,
  checkoutActivationUnexpectedError,
  jsonOk as checkoutJsonOk,
} from "@/lib/commercial/checkout-route-response";
import { requireClientInstagramSession, readString } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

type ActivateBody = {
  quote_id?: unknown;
  idempotency_key?: unknown;
  client_id?: unknown;
  amount_due_cents?: unknown;
  target_plan_key?: unknown;
  simulated_activation?: unknown;
};

function readBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = readString(value).toLowerCase();
  return ["true", "1", "yes", "on"].includes(normalized);
}

export async function POST(request: Request) {
  try {
    const session = await requireClientInstagramSession();
    if (!session.ok) {
      return checkoutActivationError(401, "session_required", {
        messageFr: "Connexion client requise pour changer de formule.",
        messageEn: "Client login is required to change plan.",
      });
    }

    const body = await readJsonBody<ActivateBody>(request);
    if (readString(body?.client_id) || body?.amount_due_cents != null || readString(body?.target_plan_key)) {
      return checkoutActivationError(400, "client_payload_not_allowed", {
        messageFr: "Confirmation invalide. Les montants sont recalculés côté serveur.",
        messageEn: "Invalid confirmation. Amounts are recalculated server-side.",
      });
    }

    const quoteId = readString(body?.quote_id);
    const idempotencyKey = readString(body?.idempotency_key);
    if (!quoteId || !idempotencyKey) {
      return checkoutActivationError(400, "quote_required", {
        messageFr: "Devis de changement de formule requis.",
        messageEn: "Plan change quote is required.",
      });
    }

    const supabase = createSupabaseClient();
    const { data: authUser } = await supabase.auth.admin.getUserById(session.userId);
    const actorEmail = readString(authUser.user?.email);

    const { data: quoteRow } = await supabase
      .from("commercial_plan_change_quotes")
      .select("client_id,amount_due_cents,payment_status")
      .eq("id", quoteId)
      .maybeSingle<{ client_id: string; amount_due_cents: number; payment_status: string | null }>();

    if (!quoteRow?.client_id || quoteRow.client_id !== session.clientId) {
      return checkoutActivationError(404, "quote_not_found", {
        messageFr: "Devis introuvable.",
        messageEn: "Quote not found.",
      });
    }

    const activationDecision = evaluatePlanChangeActivation({
      amountDueCents: Number(quoteRow.amount_due_cents ?? 0),
      actorEmail,
      paymentStatus: quoteRow.payment_status,
    });

    if (!activationDecision.ok) {
      const messages = planChangeActivationClientMessages(activationDecision.reason);
      return checkoutActivationError(402, "payment_required", {
        messageFr: messages.messageFr,
        messageEn: messages.messageEn,
      });
    }

    const simulatedActivation = activationDecision.mode === "simulated_test";
    if (readBoolean(body?.simulated_activation) && !simulatedActivation) {
      return checkoutActivationError(403, "simulated_activation_forbidden", {
        messageFr: "L'activation simulée n'est pas autorisée pour ce changement de formule.",
        messageEn: "Simulated activation is not allowed for this plan change.",
      });
    }

    const result = await activatePlanChangeQuote(supabase, {
      quoteId,
      idempotencyKey,
      actorEmail,
      simulatedActivation,
    });

    if (!result.ok) {
      return checkoutActivationError(result.status, result.code, {
        messageFr: result.messageFr,
        messageEn: result.messageEn,
      });
    }

    return checkoutJsonOk({
      idempotent_replay: result.idempotentReplay,
      checkout_context: "existing_workspace_plan_change",
      redirect_path: "/instagram-client",
      client_id: result.clientId,
      checkout_session_id: result.checkoutSessionId,
      message_fr: result.idempotentReplay
        ? "Changement de formule déjà confirmé."
        : "Changement de formule confirmé. Votre échéance actuelle est conservée.",
      message_en: result.idempotentReplay
        ? "Plan change was already confirmed."
        : "Plan change confirmed. Your current subscription end date is unchanged.",
    });
  } catch (error) {
    return checkoutActivationUnexpectedError(error);
  }
}
