"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy, PauseCircle, RotateCcw, SlidersHorizontal, XCircle } from "lucide-react";

type AccountStatusAction = "pause" | "cancel" | "mark_needs_assistance" | "reactivate";

type AccountStatusActionMenuProps = {
  accountId: string;
  username: string;
  operationsStatus: string;
};

const actions: Array<{
  action: AccountStatusAction;
  label: string;
  description: string;
  tone?: "danger";
  Icon: typeof PauseCircle;
}> = [
  {
    action: "pause",
    label: "Pause account",
    description: "Blocks runs but keeps the assigned slot and app instance.",
    Icon: PauseCircle,
  },
  {
    action: "cancel",
    label: "Cancel account",
    description: "Releases the slot and app instance when no run is active.",
    tone: "danger",
    Icon: XCircle,
  },
  {
    action: "mark_needs_assistance",
    label: "Mark needs assistance",
    description: "Blocks runs but keeps assignment for support review.",
    Icon: LifeBuoy,
  },
  {
    action: "reactivate",
    label: "Reactivate account",
    description: "Requests reactivation; runtime gates still decide readiness.",
    Icon: RotateCcw,
  },
];

export default function AccountStatusActionMenu({
  accountId,
  username,
  operationsStatus,
}: AccountStatusActionMenuProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function applyAction(action: AccountStatusAction) {
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/instagram-dashboard/accounts/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          action,
          reason: `client_accounts_${action}`,
          metadata: { source_status: operationsStatus },
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not update account status.");
      }
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update account status.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <span className="ig-client-accounts-status-menu">
      <button
        type="button"
        className="ig-client-accounts-action-link"
        title="Status actions"
        aria-label={`Status actions for ${username}`}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
      >
        <SlidersHorizontal aria-hidden />
      </button>
      {isOpen ? (
        <span className="ig-client-accounts-status-popover" role="menu">
          {actions.map(({ action, label, description, tone, Icon }) => {
            const disabled =
              isSaving ||
              (action === "pause" && operationsStatus === "paused") ||
              (action === "cancel" && operationsStatus === "cancelled") ||
              (action === "mark_needs_assistance" && operationsStatus === "needs-assistance") ||
              (action === "reactivate" && operationsStatus === "active");
            return (
              <button
                key={action}
                type="button"
                role="menuitem"
                className={tone === "danger" ? "ig-client-accounts-status-menu-item ig-client-accounts-status-menu-item-danger" : "ig-client-accounts-status-menu-item"}
                disabled={disabled}
                onClick={() => void applyAction(action)}
              >
                <Icon aria-hidden />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </button>
            );
          })}
          {message ? <small className="ig-client-accounts-status-menu-error">{message}</small> : null}
        </span>
      ) : null}
    </span>
  );
}
