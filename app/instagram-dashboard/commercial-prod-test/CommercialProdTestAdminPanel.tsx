"use client";

import { useEffect, useState } from "react";
import StripeTestCheckoutPanel from "./StripeTestCheckoutPanel";

type AuthorizationStatus = {
  id: string;
  emailHint: string;
  status: string;
  expiresAt: string;
  maxAccounts: number;
  entitlementsCreatedCount: number;
  firstCheckoutUsed: boolean;
  addAccountUsed: boolean;
  hasLinkedClient: boolean;
  nonBillable: true;
  paymentCollected: false;
  authorizedFlows: Array<"first_purchase" | "new_account">;
};

export default function CommercialProdTestAdminPanel() {
  const [email, setEmail] = useState("");
  const [durationHours, setDurationHours] = useState(48);
  const [activationAllowance, setActivationAllowance] = useState(1);
  const [scope, setScope] = useState<"add_account" | "first_purchase">("add_account");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [authorizations, setAuthorizations] = useState<AuthorizationStatus[]>([]);

  async function loadAuthorizations() {
    const response = await fetch("/api/instagram-dashboard/commercial/prod-test-authorizations", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json() as {
      ok?: boolean;
      data?: { authorizations?: AuthorizationStatus[] };
      error?: string;
    };
    if (payload.ok && payload.data?.authorizations) {
      setAuthorizations(payload.data.authorizations);
    }
  }

  useEffect(() => {
    void loadAuthorizations();
  }, []);

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/instagram-dashboard/commercial/prod-test-authorizations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          email,
          duration_hours: durationHours,
          max_accounts: activationAllowance,
          scope,
          admin_confirmation_acknowledged: confirmed,
        }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        data?: { message_fr?: string };
        error?: string;
      };
      if (!payload.ok) {
        throw new Error(payload.error || "create_failed");
      }
      setSuccess(payload.data?.message_fr || "Autorisation créée.");
      setEmail("");
      setConfirmed(false);
      await loadAuthorizations();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "create_failed");
    } finally {
      setLoading(false);
    }
  }

  async function onRevoke(authorization: AuthorizationStatus) {
    if (!window.confirm(`Désactiver l'activation Test pour ${authorization.emailHint} ?`)) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/instagram-dashboard/commercial/prod-test-authorizations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          authorization_id: authorization.id,
          admin_confirmation_acknowledged: true,
        }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        data?: { message_fr?: string };
        error?: string;
      };
      if (!payload.ok) throw new Error(payload.error || "revoke_failed");
      setSuccess(payload.data?.message_fr || "Activation Test désactivée.");
      await loadAuthorizations();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "revoke_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="commercial-prod-test-admin">
      <p className="commercial-prod-test-admin-intro">
        Source canonique serveur de l&apos;activation Test en production. Active, étends ou désactive une autorisation
        temporaire ciblée. Aucun tenant, checkout, paiement ou email n&apos;est déclenché ici.
      </p>

      <form className="commercial-prod-test-admin-form" onSubmit={(event) => void onCreate(event)}>
        <label>
          Adresse e-mail à autoriser
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Durée (heures, max 168)
          <input
            type="number"
            min={1}
            max={168}
            value={durationHours}
            onChange={(event) => setNumberInput(setDurationHours, event.target.value, 48)}
          />
        </label>
        <label>
          Portée de l&apos;autorisation
          <select value={scope} onChange={(event) => setScope(event.target.value as "add_account" | "first_purchase")}>
            <option value="add_account">Ajout de compte — tenant existant</option>
            <option value="first_purchase">Premier achat — nouveau tenant</option>
          </select>
        </label>
        <label>
          Activations Test accordées à cette autorisation (max 10)
          <input
            type="number"
            min={1}
            max={10}
            value={activationAllowance}
            onChange={(event) => setNumberInput(setActivationAllowance, event.target.value, 1)}
          />
        </label>
        <label className="commercial-prod-test-admin-confirm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          Je confirme qu&apos;il s&apos;agit d&apos;un parcours interne non facturable (first_purchase + add-account).
        </label>
        <button type="submit" disabled={loading || !confirmed || !email.trim()}>
          {loading ? "Traitement…" : "Activer, étendre ou renouveler"}
        </button>
      </form>

      {error ? <p className="commercial-prod-test-admin-error">{error}</p> : null}
      {success ? <p className="commercial-prod-test-admin-success">{success}</p> : null}

      <section>
        <h2>Autorisations récentes (redacted)</h2>
        <ul>
          {authorizations.map((authorization) => (
            <li key={authorization.id}>
              <strong>{authorization.emailHint}</strong>
              {" · "}
              {authorization.status}
              {" · portée "}
              {authorization.authorizedFlows.includes("new_account") ? "add-account" : "first-purchase"}
              {" · expire "}
              {new Date(authorization.expiresAt).toLocaleString("fr-FR")}
              {" · activations Test "}
              {authorization.entitlementsCreatedCount}/{authorization.maxAccounts}
              {" · first "}
              {authorization.firstCheckoutUsed ? "oui" : "non"}
              {" · add-account "}
              {authorization.addAccountUsed ? "oui" : "non"}
              {" · tenant "}
              {authorization.hasLinkedClient ? "lié" : "—"}
              {" · aucun paiement"}
              {authorization.status === "active" ? (
                <button
                  type="button"
                  className="commercial-prod-test-admin-revoke"
                  disabled={loading}
                  onClick={() => void onRevoke(authorization)}
                >
                  Désactiver
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <StripeTestCheckoutPanel />

      <style jsx>{`
        .commercial-prod-test-admin { display: grid; gap: 16px; max-width: 760px; }
        .commercial-prod-test-admin-intro { line-height: 1.5; color: #44403c; }
        .commercial-prod-test-admin-form { display: grid; gap: 12px; }
        label { display: grid; gap: 6px; font-weight: 600; }
        input[type="email"], input[type="number"], select { padding: 10px 12px; border: 1px solid #d6d3d1; border-radius: 10px; }
        .commercial-prod-test-admin-confirm { font-weight: 500; grid-template-columns: auto 1fr; align-items: start; }
        button { justify-self: start; padding: 10px 16px; border: none; border-radius: 999px; background: #0f766e; color: white; font-weight: 700; cursor: pointer; }
        button:disabled { opacity: .55; cursor: not-allowed; }
        .commercial-prod-test-admin-revoke { margin-left: 10px; padding: 5px 10px; background: #b91c1c; }
        .commercial-prod-test-admin-error { color: #b91c1c; }
        .commercial-prod-test-admin-success { color: #047857; }
        ul { padding-left: 18px; line-height: 1.5; }
      `}</style>
    </div>
  );
}

function setNumberInput(setter: (value: number) => void, raw: string, fallback: number) {
  const parsed = Number(raw);
  setter(Number.isFinite(parsed) ? parsed : fallback);
}
