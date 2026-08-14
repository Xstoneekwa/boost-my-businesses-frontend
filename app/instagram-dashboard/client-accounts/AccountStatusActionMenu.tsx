"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy, PauseCircle, RotateCcw, SlidersHorizontal, XCircle } from "lucide-react";
import type { ClientAccountLifecycleActionAvailability, ClientAccountLifecycleActionKey } from "../client-accounts-data";
import {
  lifecycleActionCopy,
  type LifecycleLocale,
} from "@/lib/instagram-dashboard/lifecycle-communication-registry";

type AccountStatusAction = ClientAccountLifecycleActionKey;

type AccountStatusActionMenuProps = {
  accountId: string;
  username: string;
  operationsStatus: string;
  actions: ClientAccountLifecycleActionAvailability[];
  locale?: LifecycleLocale;
};

const actionIcons: Array<{
  action: AccountStatusAction;
  tone?: "danger";
  Icon: typeof PauseCircle;
}> = [
  {
    action: "pause",
    Icon: PauseCircle,
  },
  {
    action: "cancel",
    tone: "danger",
    Icon: XCircle,
  },
  {
    action: "mark_needs_assistance",
    Icon: LifeBuoy,
  },
  {
    action: "reactivate",
    Icon: RotateCcw,
  },
];

export default function AccountStatusActionMenu({
  accountId,
  username,
  operationsStatus,
  actions: actionAvailability,
  locale = "en",
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
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        converged?: boolean;
        action_required?: boolean;
        action_required_reason?: string | null;
        commercial_state?: string;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not update account status.");
      }
      const actionLabel = lifecycleActionCopy(locale, action).label;
      if (payload.action_required) {
        setMessage(locale === "fr"
          ? `${actionLabel} — convergence en cours (${payload.action_required_reason || "action_required"}).`
          : `${actionLabel} — convergence in progress (${payload.action_required_reason || "action_required"}).`);
        router.refresh();
        return;
      }
      if (payload.converged === false) {
        setMessage(locale === "fr" ? `${actionLabel} — convergence en cours.` : `${actionLabel} — convergence in progress.`);
        router.refresh();
        return;
      }
      setIsOpen(false);
      setMessage(locale === "fr" ? `${actionLabel} confirmé.` : `${actionLabel} confirmed.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error
        ? error.message
        : locale === "fr" ? "Impossible de mettre à jour le statut du compte." : "Could not update account status.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <span className="ig-client-accounts-status-menu">
      <button
        type="button"
        className="ig-client-accounts-action-link"
        title={locale === "fr" ? "Actions de statut" : "Status actions"}
        aria-label={locale === "fr" ? `Actions de statut pour ${username}` : `Status actions for ${username}`}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
      >
        <SlidersHorizontal aria-hidden />
      </button>
      {isOpen ? (
        <span className="ig-client-accounts-status-popover" role="menu">
          {actionIcons.map(({ action, tone, Icon }) => {
            const { label, description } = lifecycleActionCopy(locale, action);
            const availability = actionAvailability.find((item) => item.action === action);
            const disabled = isSaving || availability?.disabled === true;
            const title = availability?.disabledReason ?? description;
            return (
              <button
                key={action}
                type="button"
                role="menuitem"
                className={tone === "danger" ? "ig-client-accounts-status-menu-item ig-client-accounts-status-menu-item-danger" : "ig-client-accounts-status-menu-item"}
                disabled={disabled}
                title={title}
                aria-label={`${label}: ${title}`}
                onClick={() => void applyAction(action)}
              >
                <Icon aria-hidden />
                <span>
                  <strong>{label}</strong>
                  <small>{title}</small>
                </span>
              </button>
            );
          })}
          {message ? <small className="ig-client-accounts-status-menu-error">{message}</small> : null}
        </span>
      ) : null}
      {!isOpen && message ? <small className="ig-client-accounts-action-message">{message}</small> : null}
    </span>
  );
}
