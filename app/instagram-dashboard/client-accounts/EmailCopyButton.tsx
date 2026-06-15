"use client";

import { useState } from "react";

type EmailCopyButtonProps = {
  email: string;
  emailSource: string | null;
};

export default function EmailCopyButton({ email, emailSource }: EmailCopyButtonProps) {
  const [message, setMessage] = useState("");
  const hasEmail = email !== "unknown" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const title = hasEmail ? "Copy email" : "No email available";

  async function copyEmail() {
    if (!hasEmail) return;
    try {
      await navigator.clipboard.writeText(email);
      setMessage("Email copied");
      window.setTimeout(() => setMessage(""), 1800);
    } catch {
      setMessage("Could not copy email");
      window.setTimeout(() => setMessage(""), 2200);
    }
  }

  return (
    <span className="ig-client-accounts-email">
      <button
        type="button"
        className={hasEmail ? "ig-client-accounts-email-button" : "ig-client-accounts-email-button ig-client-accounts-email-button-disabled"}
        title={title}
        aria-label={title}
        disabled={!hasEmail}
        onClick={copyEmail}
      >
        {email}
      </button>
      <small>{hasEmail ? emailSource ?? "safe source" : "No email available"}</small>
      {message ? <small className="ig-client-accounts-email-toast">{message}</small> : null}
    </span>
  );
}
