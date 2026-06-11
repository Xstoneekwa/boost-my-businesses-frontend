"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

type RequestPasswordUpdateButtonProps = {
  accountId: string;
  username: string;
  disabledReason?: string | null;
};

type PasswordUpdateResponse = {
  ok?: boolean;
  error?: string;
  data?: {
    notification_status?: string;
    email_delivery_status?: string;
  };
};

export default function RequestPasswordUpdateButton({
  accountId,
  username,
  disabledReason,
}: RequestPasswordUpdateButtonProps) {
  const router = useRouter();
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState("");
  const disabled = Boolean(disabledReason) || isSending;
  const title = disabledReason
    ? `Request password update: ${disabledReason}`
    : "Request password update: The client will be notified in their dashboard and by email.";

  async function sendRequest() {
    if (disabled) return;
    const confirmed = window.confirm(
      `Send password update request?\n\nThe client will be notified in their dashboard and by email.\n\nAccount: ${username}`,
    );
    if (!confirmed) return;

    setIsSending(true);
    setMessage("");
    try {
      const response = await fetch("/api/instagram-dashboard/client-accounts/password-update-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          reason: "password_update_required",
          metadata: {
            source: "client_accounts",
            requested_action: "notify_client",
          },
        }),
      });
      const payload = await response.json() as PasswordUpdateResponse;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not request password update.");
      }
      const alreadyRequested = payload.data?.notification_status === "already_requested";
      const emailPending = payload.data?.email_delivery_status === "pending_backend";
      setMessage(alreadyRequested
        ? "Password update already requested."
        : emailPending
          ? "Password update requested. Dashboard notification created; email delivery is pending backend."
          : "Password update requested.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request password update.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <span className="ig-client-accounts-request-password">
      <button
        type="button"
        className={disabled ? "ig-client-accounts-action-disabled" : "ig-client-accounts-action-link"}
        title={title}
        aria-label={title}
        disabled={disabled}
        onClick={sendRequest}
      >
        <RefreshCw aria-hidden />
      </button>
      {message ? <small className="ig-client-accounts-action-message">{message}</small> : null}
    </span>
  );
}
