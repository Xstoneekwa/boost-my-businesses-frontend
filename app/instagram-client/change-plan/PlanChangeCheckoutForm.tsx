"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseCheckoutApiResponse } from "@/lib/commercial/parse-checkout-api-response";
import { COMMERCIAL_PLANS, isPlanKey, type PlanKey } from "@/lib/commercial/catalog";

type PlanChangeQuote = {
  quoteId: string;
  idempotencyKey: string;
  expiresAt: string;
  currentPlanLabel: string;
  currentPlanKey: PlanKey;
  targetPlanKey: PlanKey;
  targetPlanLabel: string;
  billingIntervalMonths: number;
  periodEndAt: string;
  activeCommercialPeriodValueCents?: number;
  currentUnusedCreditCents: number;
  targetRemainingCostCents: number;
  existingCustomerCreditCents: number;
  availableCreditCents: number;
  creditAppliedCents?: number;
  amountDueCents: number;
  remainingCreditCents: number;
  simulatedActivationAvailable?: boolean;
  activationMessageFr?: string | null;
  activationMessageEn?: string | null;
};

type CurrentPlan = {
  label: string;
  period_end_at: string;
  billing_interval_months: number;
};

function euros(cents: number, lang: "fr" | "en") {
  const amount = (cents / 100).toFixed(2);
  return lang === "fr" ? `${amount.replace(".", ",")} €` : `€${amount}`;
}

function formatDate(iso: string, lang: "fr" | "en") {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function PlanChangeCheckoutForm(props: { lang?: "fr" | "en" }) {
  const lang = props.lang ?? "fr";
  const router = useRouter();
  const [targetPlanKey, setTargetPlanKey] = useState<PlanKey>("growth");
  const quoteIdempotencyKey = useMemo(
    () => `${targetPlanKey}:${crypto.randomUUID()}`,
    [targetPlanKey],
  );
  const [currentPlan, setCurrentPlan] = useState<CurrentPlan | null>(null);
  const [quote, setQuote] = useState<PlanChangeQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadQuote() {
      setQuoting(true);
      setError("");
      setSuccess("");
      const response = await fetch("/api/commercial/checkout/plan-change/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          target_plan_key: targetPlanKey,
          idempotency_key: quoteIdempotencyKey,
        }),
      });
      const parsed = await parseCheckoutApiResponse<{
        quote?: PlanChangeQuote;
        current_plan?: CurrentPlan | null;
      }>(response, {
        messageFr: "Impossible de calculer le changement de formule.",
        messageEn: "Could not calculate the plan change.",
      });
      if (cancelled) return;
      setQuoting(false);
      if (!parsed.ok || !parsed.data?.quote) {
        setQuote(null);
        setError(lang === "fr" ? parsed.clientMessageFr : parsed.clientMessageEn);
        return;
      }
      setQuote(parsed.data.quote);
      if (parsed.data.current_plan) setCurrentPlan(parsed.data.current_plan);
    }
    void loadQuote();
    return () => { cancelled = true; };
  }, [targetPlanKey, quoteIdempotencyKey, lang]);

  async function onConfirm() {
    if (!quote) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/commercial/checkout/plan-change/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          quote_id: quote.quoteId,
          idempotency_key: quote.idempotencyKey,
        }),
      });
      const parsed = await parseCheckoutApiResponse<{
        message_fr?: string;
        message_en?: string;
        redirect_path?: string;
      }>(response, {
        messageFr: "Impossible de confirmer le changement de formule.",
        messageEn: "Could not confirm the plan change.",
      });
      if (!parsed.ok) {
        throw new Error(lang === "fr" ? parsed.clientMessageFr : parsed.clientMessageEn);
      }
      setSuccess(lang === "fr" ? parsed.data?.message_fr ?? "" : parsed.data?.message_en ?? "");
      router.push(parsed.data?.redirect_path || "/instagram-client");
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : String(confirmError));
    } finally {
      setLoading(false);
    }
  }

  const intervalLabel = currentPlan?.billing_interval_months
    ? `${currentPlan.billing_interval_months} ${lang === "fr" ? "mois (verrouillée)" : "months (locked)"}`
    : (lang === "fr" ? "Durée actuelle verrouillée" : "Current term locked");

  return (
    <div className="commercial-checkout">
      <div className="commercial-checkout-banner">
        {lang === "fr"
          ? "Changement de formule — simulation interne, aucun paiement réel prélevé."
          : "Plan change — internal simulation, no real payment collected."}
      </div>

      <h1>{lang === "fr" ? "Changer de formule" : "Change plan"}</h1>

      <div className="commercial-checkout-grid">
        <label>
          {lang === "fr" ? "Nouveau pack" : "New plan"}
          <select value={targetPlanKey} onChange={(e) => setTargetPlanKey(e.target.value as PlanKey)}>
            {Object.values(COMMERCIAL_PLANS)
              .filter((plan) => isPlanKey(plan.planKey))
              .map((plan) => (
                <option key={plan.planKey} value={plan.planKey}>{plan.displayName}</option>
              ))}
          </select>
        </label>

        <div className="line locked">
          <strong>{lang === "fr" ? "Durée active actuelle" : "Current active term"}</strong>
          <div>{intervalLabel}</div>
        </div>
      </div>

      {quote && (
        <div className="commercial-checkout-lines">
          <div className="line">
            <strong>{lang === "fr" ? "Formule actuelle" : "Current plan"}</strong>
            <div>{quote.currentPlanLabel}</div>
            <div>{lang === "fr" ? "Échéance actuelle" : "Current end date"} : {formatDate(quote.periodEndAt, lang)}</div>
          </div>

          <div className="line">
            <strong>{lang === "fr" ? "Valeur restante de l'abonnement actuel" : "Remaining value of current plan"}</strong>
            <div>{euros(quote.currentUnusedCreditCents, lang)}</div>
          </div>

          <div className="line">
            <strong>{lang === "fr" ? "Nouveau pack sélectionné" : "Selected new plan"}</strong>
            <div>{quote.targetPlanLabel}</div>
            <div>{lang === "fr" ? "Coût jusqu'à l'échéance actuelle" : "Cost until current end date"} : {euros(quote.targetRemainingCostCents, lang)}</div>
          </div>

          {quote.existingCustomerCreditCents > 0 ? (
            <div className="line">
              <strong>{lang === "fr" ? "Avoir client existant" : "Existing client credit"}</strong>
              <div>{euros(quote.existingCustomerCreditCents, lang)}</div>
            </div>
          ) : null}

          <div className="line">
            <strong>{lang === "fr" ? "Crédit appliqué" : "Credit applied"}</strong>
            <div>{euros(quote.creditAppliedCents ?? quote.availableCreditCents, lang)}</div>
          </div>

          <div className="line total">
            <strong>{lang === "fr" ? "Montant à payer aujourd'hui" : "Amount due today"}</strong>
            <div>{euros(quote.amountDueCents, lang)}</div>
          </div>

          {quote.remainingCreditCents > 0 ? (
            <div className="line credit">
              <strong>{lang === "fr" ? "Avoir restant après changement" : "Remaining credit after change"}</strong>
              <div>{euros(quote.remainingCreditCents, lang)}</div>
            </div>
          ) : null}

          <p className="commercial-checkout-notice">
            {lang === "fr"
              ? `Votre échéance reste fixée au ${formatDate(quote.periodEndAt, lang)}.`
              : `Your subscription end date stays ${formatDate(quote.periodEndAt, lang)}.`}
          </p>
        </div>
      )}

      {error ? <p className="commercial-checkout-error">{error}</p> : null}
      {success ? <p className="commercial-checkout-notice">{success}</p> : null}

      {quote?.activationMessageFr || quote?.activationMessageEn ? (
        <p className="commercial-checkout-notice">
          {lang === "fr" ? quote?.activationMessageFr : quote?.activationMessageEn}
        </p>
      ) : null}

      <button
        type="button"
        disabled={
          loading
          || quoting
          || !quote
          || (Boolean(quote?.amountDueCents) && quote!.amountDueCents > 0 && !quote?.simulatedActivationAvailable)
        }
        onClick={() => void onConfirm()}
      >
        {loading
          ? (lang === "fr" ? "Confirmation..." : "Confirming...")
          : quote && quote.amountDueCents > 0
            ? (lang === "fr" ? "Simuler l'activation" : "Simulate activation")
            : (lang === "fr" ? "Confirmer le changement" : "Confirm plan change")}
      </button>

      <style jsx>{`
        .commercial-checkout { max-width: 720px; margin: 0 auto; padding: 32px 20px; color: #f5f5f4; }
        .commercial-checkout-banner { background: rgba(245,158,11,.15); border: 1px solid rgba(245,158,11,.35); padding: 12px 14px; border-radius: 12px; margin-bottom: 20px; }
        .commercial-checkout-grid { display: grid; gap: 16px; margin: 20px 0; }
        label { display: grid; gap: 8px; }
        select { padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.04); color: inherit; }
        .commercial-checkout-lines { display: grid; gap: 16px; margin: 24px 0; }
        .line { padding: 16px; border: 1px solid rgba(255,255,255,.12); border-radius: 14px; background: rgba(255,255,255,.03); }
        .line.total { border-color: rgba(16,185,129,.35); }
        .line.credit { border-color: rgba(59,130,246,.35); }
        .line.locked { border-style: dashed; opacity: .92; }
        button { padding: 12px 18px; border-radius: 999px; border: none; background: #10b981; color: #04120d; font-weight: 700; cursor: pointer; }
        button:disabled { opacity: .55; cursor: not-allowed; }
        .commercial-checkout-error { color: #fca5a5; }
        .commercial-checkout-notice { color: #fcd34d; line-height: 1.5; }
      `}</style>
    </div>
  );
}
