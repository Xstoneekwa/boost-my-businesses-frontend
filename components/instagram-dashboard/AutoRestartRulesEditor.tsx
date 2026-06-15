"use client";

import { useMemo, useState } from "react";
import type { AutoRestartRulePreview } from "@/app/instagram-dashboard/auto-restart-data";

type SaveState = "idle" | "saving" | "saved" | "error";

type Props = {
  initialRules: AutoRestartRulePreview;
  backendPending: boolean;
};

type PatchBody = {
  auto_restart_enabled: boolean;
  mode: AutoRestartRulePreview["mode"];
  restart_delay_minutes: number;
  max_attempts_per_session: number;
  resume_follow_if_quota_remaining: boolean;
  resume_unfollow_if_quota_remaining: boolean;
  block_on_challenge: boolean;
  block_on_restriction: boolean;
  block_on_account_mismatch: boolean;
  block_on_device_offline: boolean;
  notify_on_blocked_restart: boolean;
};

export default function AutoRestartRulesEditor({ initialRules, backendPending }: Props) {
  const [rules, setRules] = useState(initialRules);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const dirty = useMemo(
    () => JSON.stringify(rules) !== JSON.stringify(initialRules),
    [initialRules, rules],
  );

  async function handleSave() {
    setSaveState("saving");
    setErrorMessage("");
    const body: PatchBody = {
      auto_restart_enabled: rules.enabled,
      mode: rules.mode,
      restart_delay_minutes: rules.restartDelayMinutes,
      max_attempts_per_session: rules.maxAttemptsPerSession,
      resume_follow_if_quota_remaining: rules.resumeFollowIfQuotaRemaining,
      resume_unfollow_if_quota_remaining: rules.resumeUnfollowIfQuotaRemaining,
      block_on_challenge: rules.blockOnChallenge,
      block_on_restriction: rules.blockOnRestriction,
      block_on_account_mismatch: rules.blockOnAccountMismatch,
      block_on_device_offline: rules.blockOnDeviceOffline,
      notify_on_blocked_restart: rules.notifyOnBlockedRestart,
    };

    try {
      const response = await fetch("/api/instagram-dashboard/auto-restart/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Save failed");
      }
      if (payload.data?.rules) {
        setRules(payload.data.rules as AutoRestartRulePreview);
      }
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Save failed");
    }
  }

  return (
    <div className="ig-ar-editor">
      {backendPending ? (
        <p className="ig-ar-pending-note" role="status">
          Backend pending: apply migration `20260615131500_botapp_auto_restart_settings` before real save/load.
        </p>
      ) : null}

      <div className="ig-ar-rule-grid">
        <ToggleField
          label="Auto Restart"
          checked={rules.enabled}
          helper="Enables resume planning and BotApp visibility. Scheduler enqueue remains disabled."
          onChange={(checked) => setRules((current) => ({ ...current, enabled: checked }))}
        />
        <ToggleField
          label="Resume follow if quota remaining"
          checked={rules.resumeFollowIfQuotaRemaining}
          helper="Follow phase may be included in resume plan when quota remains."
          onChange={(checked) => setRules((current) => ({ ...current, resumeFollowIfQuotaRemaining: checked }))}
        />
        <ToggleField
          label="Resume unfollow if quota remaining"
          checked={rules.resumeUnfollowIfQuotaRemaining}
          helper="Unfollow phase may be included in resume plan when quota remains."
          onChange={(checked) => setRules((current) => ({ ...current, resumeUnfollowIfQuotaRemaining: checked }))}
        />
        <ToggleField
          label="Block on challenge"
          checked={rules.blockOnChallenge}
          helper="Blocks restart when challenge/checkpoint unsafe markers are present."
          onChange={(checked) => setRules((current) => ({ ...current, blockOnChallenge: checked }))}
        />
        <ToggleField
          label="Block on restriction / action block"
          checked={rules.blockOnRestriction}
          helper="Blocks restart when restriction or action-block markers are present."
          onChange={(checked) => setRules((current) => ({ ...current, blockOnRestriction: checked }))}
        />
        <ToggleField
          label="Block on account mismatch"
          checked={rules.blockOnAccountMismatch}
          helper="Blocks restart when logged-in account does not match assignment."
          onChange={(checked) => setRules((current) => ({ ...current, blockOnAccountMismatch: checked }))}
        />
        <ToggleField
          label="Block on device offline"
          checked={rules.blockOnDeviceOffline}
          helper="Blocks restart when device-offline unsafe markers are present."
          onChange={(checked) => setRules((current) => ({ ...current, blockOnDeviceOffline: checked }))}
        />
        <ToggleField
          label="Notify on blocked restart"
          checked={rules.notifyOnBlockedRestart}
          helper="Future alert hook when restart is blocked by safety gates."
          onChange={(checked) => setRules((current) => ({ ...current, notifyOnBlockedRestart: checked }))}
        />
        <NumberField
          label="Restart delay"
          value={rules.restartDelayMinutes}
          suffix="minutes between attempts"
          min={1}
          max={1440}
          onChange={(value) => setRules((current) => ({ ...current, restartDelayMinutes: value }))}
        />
        <NumberField
          label="Max attempts per session"
          value={rules.maxAttemptsPerSession}
          suffix="per business session"
          min={0}
          max={20}
          onChange={(value) => setRules((current) => ({ ...current, maxAttemptsPerSession: value }))}
        />
      </div>

      <div className="ig-ar-editor-actions">
        <button
          type="button"
          className="ig-ar-save-btn"
          disabled={backendPending || saveState === "saving" || !dirty}
          onClick={() => void handleSave()}
        >
          {saveState === "saving" ? "Saving…" : "Save settings"}
        </button>
        <span className="ig-ar-editor-meta">
          Mode: {rules.mode} · Source: {rules.sourceLabel}
          {saveState === "saved" ? " · Saved" : ""}
          {saveState === "error" && errorMessage ? ` · ${errorMessage}` : ""}
        </span>
      </div>
    </div>
  );
}

function ToggleField({
  label,
  checked,
  helper,
  onChange,
}: {
  label: string;
  checked: boolean;
  helper: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={checked ? "ig-ar-field ig-ar-switch ig-ar-switch-on" : "ig-ar-field ig-ar-switch"}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="ig-ar-switch-dot" aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{checked ? "On" : "Off"}</strong>
        <small>{helper}</small>
      </div>
    </button>
  );
}

function NumberField({
  label,
  value,
  suffix,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="ig-ar-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (!Number.isFinite(parsed)) return;
          onChange(Math.min(max, Math.max(min, Math.trunc(parsed))));
        }}
      />
      <small>{suffix}</small>
    </label>
  );
}
