"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CHECKOUT_UNAVAILABLE_FR,
  QUOTE_UNAVAILABLE_EN,
  QUOTE_UNAVAILABLE_FR,
} from "@/lib/commercial/checkout-api-messages";
import { parseCheckoutApiResponse } from "@/lib/commercial/parse-checkout-api-response";
import {
  COMMERCIAL_PLANS,
  OUTREACH_ADDONS,
  isOutreachAddonKey,
  isPlanKey,
  type BillingIntervalMonths,
  type OutreachAddonKey,
  type PlanKey,
} from "@/lib/commercial/catalog";

type QuoteLine = {
  label: string;
  baseMonthlyPriceCents: number;
  discountPercent: number;
  monthlyDiscountedPriceCents: number;
  billingIntervalMonths: number;
  billingPeriodTotalCents: number;
};

type QuotePayload = {
  planKey: PlanKey;
  billingIntervalMonths: BillingIntervalMonths;
  outreachAddonKey: OutreachAddonKey | null;
  appliedDiscountPercent: number;
  appliedDiscountType: string;
  packLine: QuoteLine;
  outreachLine: QuoteLine | null;
  totalPeriodCents: number;
};

function euros(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function renewalLabel(months: number, lang: "fr" | "en") {
  if (lang === "en") {
    if (months === 1) return "every month";
    if (months === 3) return "every 3 months";
    if (months === 6) return "every 6 months";
    return "every 12 months";
  }
  if (months === 1) return "tous les mois";
  if (months === 3) return "tous les 3 mois";
  if (months === 6) return "tous les 6 mois";
  return "tous les 12 mois";
}

export default function CommercialCheckoutForm(props: {
  lang?: "fr" | "en";
  flowType: "first_purchase" | "additional_account";
  initialPlan?: string;
  initialMonths?: number;
  initialOutreach?: string;
}) {
  const lang = props.lang ?? "fr";
  const router = useRouter();
  const searchParams = useSearchParams();
  const [planKey, setPlanKey] = useState<PlanKey>(
    isPlanKey(props.initialPlan ?? searchParams.get("plan") ?? "pro") ? (props.initialPlan ?? searchParams.get("plan") ?? "pro") as PlanKey : "pro",
  );
  const [months, setMonths] = useState<BillingIntervalMonths>(
    [1, 3, 6, 12].includes(Number(props.initialMonths ?? searchParams.get("months") ?? 1))
      ? Number(props.initialMonths ?? searchParams.get("months") ?? 1) as BillingIntervalMonths
      : 1,
  );
  const [outreach, setOutreach] = useState<OutreachAddonKey | "">(() => {
    const raw = props.initialOutreach ?? searchParams.get("outreach") ?? "";
    return isOutreachAddonKey(raw) ? raw : "";
  });
  const [email, setEmail] = useState("");
  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [activationAvailable, setActivationAvailable] = useState(false);
  const [activationNotice, setActivationNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    let cancelled = false;
    async function loadQuote() {
      setError("");
      setActivationNotice("");
      const response = await fetch("/api/commercial/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          plan_key: planKey,
          billing_interval_months: months,
          outreach_addon_key: outreach || null,
          purchaser_email: props.flowType === "first_purchase" ? email.trim() : undefined,
        }),
      });
      const parsed = await parseCheckoutApiResponse<{
        quote?: QuotePayload;
        simulatedActivationAvailable?: boolean;
        activationMessageFr?: string | null;
        activationMessageEn?: string | null;
      }>(response, {
        messageFr: QUOTE_UNAVAILABLE_FR,
        messageEn: QUOTE_UNAVAILABLE_EN,
      });
      if (cancelled) return;
      if (!parsed.ok || !parsed.data?.quote) {
        setQuote(null);
        setActivationAvailable(false);
        setActivationNotice("");
        setError(lang === "fr" ? parsed.clientMessageFr : parsed.clientMessageEn);
        return;
      }
      setQuote(parsed.data.quote);
      setActivationAvailable(Boolean(parsed.data.simulatedActivationAvailable));
      const notice = lang === "fr"
        ? parsed.data.activationMessageFr
        : parsed.data.activationMessageEn;
      setActivationNotice(notice?.trim() || "");
    }
    void loadQuote();
    return () => { cancelled = true; };
  }, [planKey, months, outreach, email, lang, props.flowType]);

  async function onActivate() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/commercial/checkout/simulated/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          plan_key: planKey,
          billing_interval_months: months,
          outreach_addon_key: outreach || null,
          purchaser_email: email,
          idempotency_key: idempotencyKey,
          flow_type: props.flowType,
        }),
      });
      const parsed = await parseCheckoutApiResponse<{
        redirect_path?: string;
        message_fr?: string;
        message_en?: string;
      }>(response, {
        messageFr: CHECKOUT_UNAVAILABLE_FR,
      });
      if (!parsed.ok) {
        throw new Error(lang === "fr" ? parsed.clientMessageFr : parsed.clientMessageEn);
      }
      setSuccess(lang === "fr" ? parsed.data?.message_fr ?? "" : parsed.data?.message_en ?? "");
      router.push(parsed.data?.redirect_path || "/instagram-client");
    } catch (activationError) {
      const message = activationError instanceof Error ? activationError.message : String(activationError);
      if (!message.includes("JSON.parse")) {
        setError(message);
      } else {
        setError(CHECKOUT_UNAVAILABLE_FR);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="commercial-checkout">
      <div className="commercial-checkout-banner">
        {lang === "fr"
          ? "Simulation interne — aucun paiement ne sera prélevé."
          : "Internal simulation — no payment will be charged."}
      </div>

      <h1>{lang === "fr" ? "Récapitulatif checkout" : "Checkout summary"}</h1>

      <div className="commercial-checkout-grid">
        <label>
          {lang === "fr" ? "Pack" : "Plan"}
          <select value={planKey} onChange={(e) => setPlanKey(e.target.value as PlanKey)}>
            {Object.values(COMMERCIAL_PLANS).map((plan) => (
              <option key={plan.planKey} value={plan.planKey}>{plan.displayName}</option>
            ))}
          </select>
        </label>

        <label>
          {lang === "fr" ? "Durée" : "Term"}
          <select value={months} onChange={(e) => setMonths(Number(e.target.value) as BillingIntervalMonths)}>
            <option value={1}>{lang === "fr" ? "Mensuel" : "Monthly"}</option>
            <option value={3}>3 {lang === "fr" ? "mois (-10 %)" : "months (-10%)"}</option>
            <option value={6}>6 {lang === "fr" ? "mois (-20 %)" : "months (-20%)"}</option>
            <option value={12}>12 {lang === "fr" ? "mois (-25 %)" : "months (-25%)"}</option>
          </select>
        </label>

        <fieldset>
          <legend>{lang === "fr" ? "Outreach (optionnel)" : "Outreach (optional)"}</legend>
          <label><input type="radio" name="outreach" checked={outreach === ""} onChange={() => setOutreach("")} /> {lang === "fr" ? "Aucun" : "None"}</label>
          <label><input type="radio" name="outreach" checked={outreach === "outreach_standard"} onChange={() => setOutreach("outreach_standard")} /> {OUTREACH_ADDONS.outreach_standard.displayNameFr}</label>
          <label><input type="radio" name="outreach" checked={outreach === "outreach_ai"} onChange={() => setOutreach("outreach_ai")} /> {OUTREACH_ADDONS.outreach_ai.displayNameFr}</label>
        </fieldset>

        {props.flowType === "first_purchase" && (
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.com" />
          </label>
        )}
      </div>

      {quote && (
        <div className="commercial-checkout-lines">
          <div className="line">
            <strong>{lang === "fr" ? "Pack" : "Plan"} {quote.packLine.label}</strong>
            <div>{euros(quote.packLine.baseMonthlyPriceCents)} € / {lang === "fr" ? "mois" : "mo"}</div>
            {quote.appliedDiscountPercent > 0 && (
              <div>{lang === "fr" ? "Remise appliquée" : "Discount applied"} : -{Math.round(quote.appliedDiscountPercent * 100)} % ({quote.appliedDiscountType})</div>
            )}
            <div>{euros(quote.packLine.monthlyDiscountedPriceCents)} € / {lang === "fr" ? "mois" : "mo"}</div>
            <div>{euros(quote.packLine.billingPeriodTotalCents)} € {renewalLabel(quote.billingIntervalMonths, lang)}</div>
          </div>

          {quote.outreachLine && (
            <div className="line">
              <strong>{quote.outreachLine.label}</strong>
              <div>{euros(quote.outreachLine.baseMonthlyPriceCents)} € / {lang === "fr" ? "mois" : "mo"}</div>
              {quote.appliedDiscountPercent > 0 && (
                <div>{lang === "fr" ? "Remise appliquée" : "Discount applied"} : -{Math.round(quote.appliedDiscountPercent * 100)} %</div>
              )}
              <div>{euros(quote.outreachLine.monthlyDiscountedPriceCents)} € / {lang === "fr" ? "mois" : "mo"}</div>
              <div>{euros(quote.outreachLine.billingPeriodTotalCents)} € {renewalLabel(quote.billingIntervalMonths, lang)}</div>
            </div>
          )}

          <div className="line total">
            <strong>{lang === "fr" ? "Total à l'échéance" : "Total due at renewal"}</strong>
            <div>{euros(quote.totalPeriodCents)} € {renewalLabel(quote.billingIntervalMonths, lang)}</div>
          </div>
        </div>
      )}

      {error ? <p className="commercial-checkout-error">{error}</p> : null}
      {activationNotice ? <p className="commercial-checkout-notice">{activationNotice}</p> : null}
      {success ? <p className="commercial-checkout-success">{success}</p> : null}

      <button
        type="button"
        disabled={
          loading
          || !quote
          || !activationAvailable
          || (props.flowType === "first_purchase" && !email.trim())
        }
        onClick={() => void onActivate()}
      >
        {loading
          ? (lang === "fr" ? "Activation..." : "Activating...")
          : (lang === "fr" ? "Simuler l'activation" : "Simulate activation")}
      </button>

      <style jsx>{`
        .commercial-checkout { max-width: 720px; margin: 0 auto; padding: 32px 20px; color: #f5f5f4; }
        .commercial-checkout-banner { background: rgba(245,158,11,.15); border: 1px solid rgba(245,158,11,.35); padding: 12px 14px; border-radius: 12px; margin-bottom: 20px; }
        .commercial-checkout-grid { display: grid; gap: 16px; margin: 20px 0; }
        label, fieldset { display: grid; gap: 8px; }
        select, input { padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.04); color: inherit; }
        .commercial-checkout-lines { display: grid; gap: 16px; margin: 24px 0; }
        .line { padding: 16px; border: 1px solid rgba(255,255,255,.12); border-radius: 14px; background: rgba(255,255,255,.03); }
        .line.total { border-color: rgba(16,185,129,.35); }
        button { padding: 12px 18px; border-radius: 999px; border: none; background: #10b981; color: #04120d; font-weight: 700; cursor: pointer; }
        button:disabled { opacity: .55; cursor: not-allowed; }
        .commercial-checkout-error { color: #fca5a5; }
        .commercial-checkout-notice { color: #fcd34d; }
        .commercial-checkout-success { color: #86efac; }
      `}</style>
    </div>
  );
}
