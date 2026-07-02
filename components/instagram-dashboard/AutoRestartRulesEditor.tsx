"use client";

import { useMemo, useState } from "react";
import type { AutoRestartRulePreview } from "@/app/instagram-dashboard/auto-restart-data";

type SaveState = "idle" | "saving" | "saved" | "error";

type Props = {
  initialRules: AutoRestartRulePreview;
  backendPending: boolean;
  accountOptions?: Array<{ accountId: string; username: string }>;
};

type PatchBody = {
  auto_restart_enabled: boolean;
  mode: AutoRestartRulePreview["mode"];
  check_every_minutes: number;
  restart_delay_minutes: number;
  max_attempts_per_session: number;
  max_restarts_per_day_per_account: number;
  max_restarts_per_window_per_account: number;
  restart_yellow_accounts: boolean;
  restart_red_accounts: boolean;
  respect_blackout_windows: boolean;
  respect_six_hour_window: boolean;
  resume_follow_if_quota_remaining: boolean;
  resume_unfollow_if_quota_remaining: boolean;
  block_on_challenge: boolean;
  block_on_restriction: boolean;
  block_on_account_mismatch: boolean;
  block_on_device_offline: boolean;
  notify_on_blocked_restart: boolean;
  pilot_account_id: string | null;
};

export default function AutoRestartRulesEditor({ initialRules, backendPending, accountOptions = [] }: Props) {
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
      mode: rules.enabled ? rules.mode : "disabled",
      check_every_minutes: rules.checkEveryMinutes,
      restart_delay_minutes: rules.restartDelayMinutes,
      max_attempts_per_session: rules.maxAttemptsPerSession,
      max_restarts_per_day_per_account: rules.maxRestartsPerDayPerAccount,
      max_restarts_per_window_per_account: rules.maxRestartsPerWindowPerAccount,
      restart_yellow_accounts: rules.restartYellowAccounts,
      restart_red_accounts: rules.restartRedAccounts,
      respect_blackout_windows: rules.respectPhoneRest,
      respect_six_hour_window: rules.respectSixHourWindow,
      resume_follow_if_quota_remaining: rules.resumeFollowIfQuotaRemaining,
      resume_unfollow_if_quota_remaining: rules.resumeUnfollowIfQuotaRemaining,
      block_on_challenge: rules.blockOnChallenge,
      block_on_restriction: rules.blockOnRestriction,
      block_on_account_mismatch: rules.blockOnAccountMismatch,
      block_on_device_offline: rules.blockOnDeviceOffline,
      notify_on_blocked_restart: rules.notifyOnBlockedRestart,
      pilot_account_id: rules.pilotAccountId,
    };

    try {
      const response = await fetch("/api/instagram-dashboard/auto-restart/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        const reason = payload?.data?.reason || payload?.error || "Save failed";
        throw new Error(reason);
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
          Backend pending: apply migrations `20260710120000` through `20260710120200` before real save/load.
        </p>
      ) : null}

      <div className="ig-ar-rule-grid">
        <ToggleField
          label="Auto Restart"
          checked={rules.enabled}
          helper="Enables resume planning. Active mode requires foundation deploy and tick token."
          onChange={(checked) => setRules((current) => ({
            ...current,
            enabled: checked,
            mode: checked ? (current.mode === "disabled" ? "dry_run" : current.mode) : "disabled",
          }))}
        />
        <label className="ig-ar-field">
          <span>Mode</span>
          <select
            value={rules.mode}
            disabled={!rules.enabled}
            onChange={(event) => setRules((current) => ({
              ...current,
              mode: event.target.value as AutoRestartRulePreview["mode"],
            }))}
          >
            <option value="disabled">Disabled</option>
            <option value="dry_run">Dry-run</option>
            <option value="active">Active</option>
          </select>
          <small>Active mode requires pilot account, foundation deploy, and tick token.</small>
        </label>
        <label className="ig-ar-field">
          <span>Pilot account</span>
          <select
            value={rules.pilotAccountId || ""}
            onChange={(event) => setRules((current) => ({
              ...current,
              pilotAccountId: event.target.value || null,
              pilotUsername: accountOptions.find((row) => row.accountId === event.target.value)?.username || null,
            }))}
          >
            <option value="">Select pilot account</option>
            {accountOptions.map((account) => (
              <option key={account.accountId} value={account.accountId}>
                @{account.username}
              </option>
            ))}
          </select>
          <small>Exactly one account may be allowlisted for V1 pilot execution.</small>
        </label>
        <NumberField
          label="Check every"
          value={rules.checkEveryMinutes}
          suffix="minutes between scheduler ticks"
          min={1}
          max={1440}
          onChange={(value) => setRules((current) => ({ ...current, checkEveryMinutes: value }))}
        />
        <ToggleField
          label="Restart yellow accounts"
          checked={rules.restartYellowAccounts}
          helper="Allows restart for watch-tier risk accounts."
          onChange={(checked) => setRules((current) => ({ ...current, restartYellowAccounts: checked }))}
        />
        <ToggleField
          label="Restart red accounts"
          checked={rules.restartRedAccounts}
          helper="Allows restart for high-risk accounts."
          onChange={(checked) => setRules((current) => ({ ...current, restartRedAccounts: checked }))}
        />
        <ToggleField
          label="Respect fixed blackouts"
          checked={rules.respectPhoneRest}
          helper="Honors phone_rest_windows maintenance blackouts."
          onChange={(checked) => setRules((current) => ({ ...current, respectPhoneRest: checked }))}
        />
        <ToggleField
          label="Respect 6-hour session window"
          checked={rules.respectSixHourWindow}
          helper="Blocks restart outside assignment starts_at/ends_at."
          onChange={(checked) => setRules((current) => ({ ...current, respectSixHourWindow: checked }))}
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
          helper="Sends incident notification when restart is blocked by safety gates."
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
        <NumberField
          label="Max restarts per day"
          value={rules.maxRestartsPerDayPerAccount}
          suffix="per account"
          min={0}
          max={50}
          onChange={(value) => setRules((current) => ({ ...current, maxRestartsPerDayPerAccount: value }))}
        />
        <NumberField
          label="Max restarts per window"
          value={rules.maxRestartsPerWindowPerAccount}
          suffix="per rolling window"
          min={0}
          max={50}
          onChange={(value) => setRules((current) => ({ ...current, maxRestartsPerWindowPerAccount: value }))}
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
