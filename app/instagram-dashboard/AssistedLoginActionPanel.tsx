"use client";

import { useCallback, useState } from "react";

type Props = {
  accountId: string;
  actionId: string;
  reservationId: string;
  username: string;
  deviceLabel: string;
  cloneLabel: string;
  windowLabel: string;
  availabilityLabel: string;
};

export default function AssistedLoginActionPanel(props: Props) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startAutoLogin = useCallback(async () => {
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/instagram-dashboard/assisted-login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          account_id: props.accountId,
          reservation_id: props.reservationId,
          action_id: props.actionId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        setError(typeof payload?.message === "string" ? payload.message : "Start Auto Login refused.");
        return;
      }
      setMessage(typeof payload?.message === "string" ? payload.message : "Auto Login started.");
    } catch {
      setError("Start Auto Login failed.");
    } finally {
      setPending(false);
    }
  }, [props.accountId, props.reservationId, props.actionId]);

  return (
    <section className="ig-assisted-login-panel" aria-label="Assisted client login">
      <header>
        <strong>Client requested assisted connection</strong>
        <p>Review the reserved capacity, then start Auto Login explicitly when the phone is idle.</p>
      </header>
      <dl className="ig-assisted-login-grid">
        <div><dt>Client account</dt><dd>@{props.username}</dd></div>
        <div><dt>Reserved phone</dt><dd>{props.deviceLabel}</dd></div>
        <div><dt>Reserved clone / app instance</dt><dd>{props.cloneLabel}</dd></div>
        <div><dt>Reserved time window</dt><dd>{props.windowLabel}</dd></div>
        <div><dt>Current resource availability</dt><dd>{props.availabilityLabel}</dd></div>
        <div><dt>Assisted connection status</dt><dd>Waiting for operator</dd></div>
      </dl>
      <button type="button" className="ig-btn ig-btn-primary" disabled={pending} onClick={() => void startAutoLogin()}>
        {pending ? "Starting Auto Login…" : "Start Auto Login"}
      </button>
      {message ? <p className="ig-assisted-login-success">{message}</p> : null}
      {error ? <p className="ig-assisted-login-error" role="alert">{error}</p> : null}
    </section>
  );
}
