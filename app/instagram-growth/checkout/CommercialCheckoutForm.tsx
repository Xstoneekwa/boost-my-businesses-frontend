"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CHECKOUT_UNAVAILABLE_FR,
  QUOTE_UNAVAILABLE_EN,
  QUOTE_UNAVAILABLE_FR,
} from "@/lib/commercial/checkout-api-messages";
import { resolveCommercialCheckoutActivationState } from "@/lib/commercial/commercial-checkout-form-state";
import {
  CHECKOUT_PASSWORD_MIN_LENGTH,
  publicCheckoutPasswordRulesEn,
  publicCheckoutPasswordRulesFr,
  validatePublicCheckoutPassword,
} from "@/lib/commercial/checkout-password";
import { parseCheckoutApiResponse } from "@/lib/commercial/parse-checkout-api-response";
import type { CommercialPricingSnapshot } from "@/lib/commercial/pricing-snapshot";
import CommercialDiscountBreakdown from "@/app/instagram-client/CommercialDiscountBreakdown";
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
  pricingSnapshot?: CommercialPricingSnapshot;
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
  const isPublicCheckout = props.flowType === "first_purchase";
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
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [activationAvailable, setActivationAvailable] = useState(false);
  const [activationMessageFr, setActivationMessageFr] = useState<string | null>(null);
  const [activationMessageEn, setActivationMessageEn] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activationComplete, setActivationComplete] = useState(false);
  const [handoffLoginPath, setHandoffLoginPath] = useState<string | null>(null);
  const [conflictRedirectPath, setConflictRedirectPath] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const activationState = useMemo(() => resolveCommercialCheckoutActivationState({
    isPublicCheckout,
    lang,
    loading,
    quoteLoading,
    hasQuote: Boolean(quote),
    activationAvailable,
    activationMessageFr,
    activationMessageEn,
    email,
    password,
    passwordConfirmation,
  }), [
    isPublicCheckout,
    lang,
    loading,
    quoteLoading,
    quote,
    activationAvailable,
    activationMessageFr,
    activationMessageEn,
    email,
    password,
    passwordConfirmation,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadQuote() {
      setQuoteLoading(true);
      setError("");
      setActivationMessageFr(null);
      setActivationMessageEn(null);
      const response = await fetch("/api/commercial/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          plan_key: planKey,
          billing_interval_months: months,
          outreach_addon_key: outreach || null,
          purchaser_email: isPublicCheckout ? email.trim() : undefined,
          flow_type: props.flowType,
        }),
      });
      const parsed = await parseCheckoutApiResponse<{
        quote?: QuotePayload;
        simulationAvailable?: boolean;
        simulationUnavailableReason?: string | null;
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
        setActivationMessageFr(null);
        setActivationMessageEn(null);
        setError(lang === "fr" ? parsed.clientMessageFr : parsed.clientMessageEn);
        return;
      }
      setQuote(parsed.data.quote);
      const simulationAllowed = isPublicCheckout
        ? Boolean(parsed.data.simulationAvailable)
        : Boolean(parsed.data.simulatedActivationAvailable);
      setActivationAvailable(simulationAllowed);
      setActivationMessageFr(parsed.data.activationMessageFr ?? null);
      setActivationMessageEn(parsed.data.activationMessageEn ?? null);
    }
    void loadQuote().finally(() => {
      if (!cancelled) setQuoteLoading(false);
    });
    return () => { cancelled = true; };
  }, [planKey, months, outreach, email, lang, props.flowType, isPublicCheckout]);

  async function onActivate() {
    if (isPublicCheckout) {
      const validation = validatePublicCheckoutPassword({ password, passwordConfirmation });
      if (!validation.ok) {
        return;
      }
    }

    setLoading(true);
    setError("");
    setSuccess("");
    setHandoffLoginPath(null);
    setConflictRedirectPath(null);
    try {
      const response = await fetch("/api/commercial/checkout/simulated/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          plan_key: planKey,
          billing_interval_months: months,
          outreach_addon_key: outreach || null,
          purchaser_email: email,
          password: isPublicCheckout ? password : undefined,
          password_confirmation: isPublicCheckout ? passwordConfirmation : undefined,
          idempotency_key: idempotencyKey,
          flow_type: props.flowType,
        }),
      });
      const parsed = await parseCheckoutApiResponse<{
        redirect_path?: string | null;
        handoff_type?: string;
        login_path?: string | null;
        message_fr?: string;
        message_en?: string;
      }>(response, {
        messageFr: CHECKOUT_UNAVAILABLE_FR,
      });
      if (!parsed.ok) {
        const redirectPath = typeof parsed.payload?.redirect_path === "string"
          ? parsed.payload.redirect_path
          : null;
        if (redirectPath) {
          setConflictRedirectPath(redirectPath);
        }
        throw new Error(lang === "fr" ? parsed.clientMessageFr : parsed.clientMessageEn);
      }
      setSuccess(lang === "fr" ? parsed.data?.message_fr ?? "" : parsed.data?.message_en ?? "");
      if (parsed.data?.handoff_type === "email_login") {
        setActivationComplete(true);
        setHandoffLoginPath(parsed.data?.login_path || "/instagram-login");
        return;
      }
      if (parsed.data?.redirect_path) {
        router.push(parsed.data.redirect_path);
      }
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

  if (activationComplete && handoffLoginPath) {
    return (
      <div className="commercial-checkout">
        <div className="commercial-checkout-success-panel">
          <h1>{lang === "fr" ? "Activation de test confirmée" : "Test activation confirmed"}</h1>
          <p>{success}</p>
          <p className="commercial-checkout-success-note">
            {lang === "fr"
              ? "Aucun paiement n'a été encaissé. Votre espace client est prêt."
              : "No payment was collected. Your client workspace is ready."}
          </p>
          <a className="commercial-checkout-success-cta" href={handoffLoginPath}>
            {lang === "fr" ? "Se connecter à mon espace" : "Sign in to my workspace"}
          </a>
        </div>
        <style jsx>{`
          .commercial-checkout { max-width: 720px; margin: 0 auto; padding: 32px 20px; color: #f5f5f4; }
          .commercial-checkout-success-panel { padding: 28px; border: 1px solid rgba(16,185,129,.35); border-radius: 16px; background: rgba(16,185,129,.08); }
          .commercial-checkout-success-panel h1 { margin: 0 0 12px; font-size: 1.5rem; }
          .commercial-checkout-success-panel p { margin: 0 0 10px; line-height: 1.5; }
          .commercial-checkout-success-note { color: #d1fae5; }
          .commercial-checkout-success-cta { display: inline-block; margin-top: 18px; padding: 12px 18px; border-radius: 999px; background: #10b981; color: #04120d; font-weight: 700; text-decoration: none; }
        `}</style>
      </div>
    );
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

        {isPublicCheckout && (
          <>
            <label>
              {lang === "fr" ? "Adresse e-mail de connexion" : "Login email address"}
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                aria-invalid={Boolean(activationState.emailInlineError)}
                aria-describedby={activationState.emailInlineError ? "checkout-email-error" : undefined}
              />
            </label>

            <label>
              {lang === "fr" ? "Créer votre mot de passe" : "Create your password"}
              <div className="password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={CHECKOUT_PASSWORD_MIN_LENGTH}
                />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword
                    ? (lang === "fr" ? "Masquer" : "Hide")
                    : (lang === "fr" ? "Afficher" : "Show")}
                </button>
              </div>
              <span className="field-hint">{lang === "fr" ? publicCheckoutPasswordRulesFr() : publicCheckoutPasswordRulesEn()}</span>
            </label>

            <label>
              {lang === "fr" ? "Confirmer votre mot de passe" : "Confirm your password"}
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={passwordConfirmation}
                onChange={(e) => setPasswordConfirmation(e.target.value)}
                minLength={CHECKOUT_PASSWORD_MIN_LENGTH}
              />
            </label>
          </>
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
            {quote.pricingSnapshot ? (
              <CommercialDiscountBreakdown lang={lang} snapshot={quote.pricingSnapshot} showAgencyBanner />
            ) : null}
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
      {activationState.emailInlineError ? (
        <p className="commercial-checkout-error" id="checkout-email-error">{activationState.emailInlineError}</p>
      ) : null}
      {activationState.passwordInlineError ? (
        <p className="commercial-checkout-error" id="checkout-password-error">{activationState.passwordInlineError}</p>
      ) : null}
      {activationState.ctaDisabled && activationState.blockers.length > 0 ? (
        <ul className="commercial-checkout-blockers" aria-live="polite">
          {activationState.blockers.map((blocker) => (
            <li key={blocker.code}>
              {lang === "fr" ? blocker.messageFr : blocker.messageEn}
            </li>
          ))}
        </ul>
      ) : null}
      {conflictRedirectPath ? (
        <p className="commercial-checkout-handoff">
          <a href={conflictRedirectPath}>
            {conflictRedirectPath === "/instagram-login"
              ? (lang === "fr" ? "Se connecter" : "Sign in")
              : (lang === "fr" ? "Continuer depuis mon espace client" : "Continue from my client workspace")}
          </a>
        </p>
      ) : null}

      <button
        type="button"
        disabled={activationState.ctaDisabled}
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
        .password-field { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
        .password-toggle { padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.06); color: inherit; cursor: pointer; }
        .field-hint { color: #a8a29e; font-size: 0.9rem; }
        .commercial-checkout-lines { display: grid; gap: 16px; margin: 24px 0; }
        .line { padding: 16px; border: 1px solid rgba(255,255,255,.12); border-radius: 14px; background: rgba(255,255,255,.03); }
        .line.total { border-color: rgba(16,185,129,.35); }
        button { padding: 12px 18px; border-radius: 999px; border: none; background: #10b981; color: #04120d; font-weight: 700; cursor: pointer; }
        button:disabled { opacity: .55; cursor: not-allowed; }
        .commercial-checkout-error { color: #fca5a5; }
        .commercial-checkout-notice { color: #fcd34d; }
        .commercial-checkout-blockers { margin: 12px 0 0; padding-left: 18px; color: #fcd34d; line-height: 1.45; }
        .commercial-checkout-handoff { margin-top: 12px; }
        .commercial-checkout-handoff a { color: #93c5fd; font-weight: 600; }
      `}</style>
    </div>
  );
}
