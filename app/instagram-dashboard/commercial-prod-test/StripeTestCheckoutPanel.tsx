"use client";

import { useEffect, useMemo, useState } from "react";

type Readiness = {
  stripeSdkAvailable: boolean;
  testModeConfigured: boolean;
  webhookConfigured: boolean;
  testCatalogMappingsCount: number;
  portalConfigurationAvailable: boolean;
  testCheckoutEnabled: boolean;
};

type CatalogMapping = {
  id: string;
  plan_key: string;
  billing_interval_months: number;
  outreach_addon_key: string;
  stripe_product_id: string;
  stripe_price_id: string;
  active: boolean;
};

export default function StripeTestCheckoutPanel() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [mappings, setMappings] = useState<CatalogMapping[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [planKey, setPlanKey] = useState("pro");
  const [months, setMonths] = useState(1);
  const [outreach, setOutreach] = useState("");
  const [productId, setProductId] = useState("");
  const [priceId, setPriceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  async function loadState() {
    const [readinessRes, catalogRes] = await Promise.all([
      fetch("/api/instagram-dashboard/commercial/stripe-test/readiness", { cache: "no-store" }),
      fetch("/api/instagram-dashboard/commercial/stripe-test/price-catalog", { cache: "no-store" }),
    ]);
    const readinessPayload = await readinessRes.json() as { ok?: boolean; data?: { readiness?: Readiness } };
    const catalogPayload = await catalogRes.json() as { ok?: boolean; data?: { mappings?: CatalogMapping[] } };
    if (readinessPayload.ok && readinessPayload.data?.readiness) {
      setReadiness(readinessPayload.data.readiness);
    }
    if (catalogPayload.ok && catalogPayload.data?.mappings) {
      setMappings(catalogPayload.data.mappings);
    }
  }

  useEffect(() => {
    void loadState();
  }, []);

  async function saveMapping(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/instagram-dashboard/commercial/stripe-test/price-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          plan_key: planKey,
          billing_interval_months: months,
          outreach_addon_key: outreach || "none",
          stripe_product_id: productId,
          stripe_price_id: priceId,
          active: true,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!payload.ok) throw new Error(payload.error || "save_failed");
      setSuccess("Test price mapping saved.");
      await loadState();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "save_failed");
    } finally {
      setLoading(false);
    }
  }

  async function launchCheckout(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/instagram-dashboard/commercial/stripe-test/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          plan_key: planKey,
          billing_interval_months: months,
          outreach_addon_key: outreach || null,
          purchaser_email: email,
          password,
          flow_type: "first_purchase",
          idempotency_key: idempotencyKey,
        }),
      });
      const payload = await response.json() as { ok?: boolean; data?: { checkout_url?: string; message_en?: string }; error?: string; code?: string };
      if (!payload.ok) throw new Error(payload.error || payload.code || "checkout_failed");
      setSuccess(payload.data?.message_en || "Stripe Test checkout session created.");
      if (payload.data?.checkout_url) {
        window.open(payload.data.checkout_url, "_blank", "noopener,noreferrer");
      }
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "checkout_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="commercial-prod-test-stripe-panel">
      <h2>Stripe Test Checkout</h2>
      <p className="commercial-prod-test-stripe-intro">
        Admin-only Stripe Test harness. Requires prod-test authorization, server-side test price mappings,
        and Stripe Test configuration. No public checkout is replaced.
      </p>

      <div className="commercial-prod-test-stripe-readiness">
        <h3>Readiness</h3>
        <ul>
          <li>Stripe SDK available: {readiness?.stripeSdkAvailable ? "yes" : "no"}</li>
          <li>Test mode configured: {readiness?.testModeConfigured ? "yes" : "no"}</li>
          <li>Webhook configured: {readiness?.webhookConfigured ? "yes" : "no"}</li>
          <li>Test catalog mappings: {readiness?.testCatalogMappingsCount ?? 0}</li>
          <li>Portal configuration available: {readiness?.portalConfigurationAvailable ? "yes" : "no"}</li>
        </ul>
      </div>

      <form className="commercial-prod-test-stripe-form" onSubmit={(event) => void saveMapping(event)}>
        <h3>Test price mapping</h3>
        <label>
          Plan
          <select value={planKey} onChange={(event) => setPlanKey(event.target.value)}>
            <option value="growth">Growth</option>
            <option value="pro">Pro</option>
            <option value="premium">Premium</option>
          </select>
        </label>
        <label>
          Billing interval (months)
          <select value={months} onChange={(event) => setMonths(Number(event.target.value))}>
            <option value={1}>1</option>
            <option value={3}>3</option>
            <option value={6}>6</option>
            <option value={12}>12</option>
          </select>
        </label>
        <label>
          Outreach addon
          <select value={outreach} onChange={(event) => setOutreach(event.target.value)}>
            <option value="">None</option>
            <option value="outreach_standard">Outreach standard</option>
            <option value="outreach_ai">Outreach AI</option>
          </select>
        </label>
        <label>
          Stripe product ID
          <input value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="prod_..." />
        </label>
        <label>
          Stripe price ID
          <input value={priceId} onChange={(event) => setPriceId(event.target.value)} placeholder="price_..." />
        </label>
        <button type="submit" disabled={loading}>Save test mapping</button>
      </form>

      <form className="commercial-prod-test-stripe-form" onSubmit={(event) => void launchCheckout(event)}>
        <h3>Launch Stripe Test checkout</h3>
        <label>
          Authorized purchaser email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password (used once for identity prep; never stored in commercial records)
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button type="submit" disabled={loading || !email || !password}>
          Create Stripe Test checkout session
        </button>
      </form>

      {mappings.length > 0 ? (
        <div className="commercial-prod-test-stripe-mappings">
          <h3>Current test mappings</h3>
          <ul>
            {mappings.map((mapping) => (
              <li key={mapping.id}>
                {mapping.plan_key} / {mapping.billing_interval_months}m / {mapping.outreach_addon_key} → {mapping.stripe_price_id}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="commercial-prod-test-stripe-error">{error}</p> : null}
      {success ? <p className="commercial-prod-test-stripe-success">{success}</p> : null}

      <form
        className="commercial-prod-test-stripe-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const attemptId = (event.currentTarget.elements.namedItem("attempt_id") as HTMLInputElement).value.trim();
          if (!attemptId) return;
          setLoading(true);
          setError("");
          setSuccess("");
          try {
            const response = await fetch("/api/instagram-dashboard/commercial/stripe-test/recover-fulfillment", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ attempt_id: attemptId }),
            });
            const payload = await response.json() as { ok?: boolean; data?: { message_en?: string }; error?: string };
            if (!payload.ok) throw new Error(payload.error || "recovery_failed");
            setSuccess(payload.data?.message_en || "Recovery completed.");
          } catch (recoveryError) {
            setError(recoveryError instanceof Error ? recoveryError.message : "recovery_failed");
          } finally {
            setLoading(false);
          }
        }}
      >
        <h3>Recover paid attempt fulfillment</h3>
        <p className="commercial-prod-test-stripe-intro">
          Retries fulfillment for an existing paid attempt. Does not create a new Checkout or charge again.
        </p>
        <label>
          Attempt ID
          <input name="attempt_id" placeholder="uuid" required />
        </label>
        <button type="submit" disabled={loading}>Retry fulfillment</button>
      </form>
    </section>
  );
}
