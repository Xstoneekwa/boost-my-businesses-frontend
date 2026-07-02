"use client";

import { useMemo, useState } from "react";
import type { AutoRestartRulePreview } from "@/app/instagram-dashboard/auto-restart-data";

type SaveState = "idle" | "saving" | "saved" | "error";

type Props = {
  initialRules: AutoRestartRulePreview;
  foundationBlocked: boolean;
  runtimeStatus?: {
    eligibleCount: number;
    blockedCount: number;
    nextEvaluation: string | null;
    lastEvaluation: string | null;
  };
};

type PatchBody = {
  auto_restart_enabled: boolean;
  mode: "production";
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
};

function toPatch(rules: AutoRestartRulePreview): PatchBody {
  return {
    auto_restart_enabled: rules.enabled,
    mode: "production",
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
  };
}

export default function AutoRestartRulesEditor({
  initialRules,
  foundationBlocked,
  runtimeStatus,
}: Props) {
  const [rules, setRules] = useState(initialRules);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [dryRunState, setDryRunState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [dryRunMessage, setDryRunMessage] = useState("");
  const [enableConfirmOpen, setEnableConfirmOpen] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(rules) !== JSON.stringify(initialRules),
    [initialRules, rules],
  );

  async function handleSave(nextRules = rules) {
    setSaveState("saving");
    setErrorMessage("");
    try {
      const response = await fetch("/api/instagram-dashboard/auto-restart/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPatch(nextRules)),
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

  async function handleDryRun() {
    setDryRunState("running");
    setDryRunMessage("");
    try {
      const response = await fetch("/api/instagram-dashboard/auto-restart/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: true }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || payload?.data?.reason || "Dry-run check failed");
      }
      const eligible = payload?.data?.eligible_count ?? payload?.data?.summary?.eligible_count;
      setDryRunMessage(typeof eligible === "number" ? `${eligible} eligible account(s) in dry-run check.` : "Dry-run check completed.");
      setDryRunState("done");
    } catch (error) {
      setDryRunState("error");
      setDryRunMessage(error instanceof Error ? error.message : "Dry-run check failed");
    }
  }

  function requestEnabledToggle(checked: boolean) {
    if (checked && !rules.enabled) {
      setEnableConfirmOpen(true);
      return;
    }
    setRules((current) => ({ ...current, enabled: checked }));
  }

  async function confirmEnable() {
    const nextRules = { ...rules, enabled: true };
    setRules(nextRules);
    setEnableConfirmOpen(false);
    await handleSave(nextRules);
  }

  if (foundationBlocked) {
    return null;
  }

  return (
    <div className="ig-ar-editor">
      <section className="ig-ar-section">
        <h3>Automation settings</h3>
        <div className="ig-ar-fields">
          <ToggleField
            label="Enabled"
            checked={rules.enabled}
            onChange={requestEnabledToggle}
          />
          <label className="ig-ar-field ig-ar-field-static">
            <span>Operating mode</span>
            <strong>Production</strong>
            <small>Eligible accounts are determined by active schedules.</small>
          </label>
        </div>
        <div className="ig-ar-section-actions">
          <button type="button" className="ig-ar-secondary-btn" disabled={dryRunState === "running"} onClick={() => void handleDryRun()}>
            {dryRunState === "running" ? "Running check…" : "Run dry-run check"}
          </button>
          {dryRunMessage ? <span className="ig-ar-inline-meta">{dryRunMessage}</span> : null}
        </div>
      </section>

      <section className="ig-ar-section">
        <h3>Schedule and limits</h3>
        <div className="ig-ar-fields">
          <NumberField label="Check interval (minutes)" value={rules.checkEveryMinutes} min={1} max={1440} onChange={(value) => setRules((c) => ({ ...c, checkEveryMinutes: value }))} />
          <NumberField label="Restart delay (minutes)" value={rules.restartDelayMinutes} min={1} max={1440} onChange={(value) => setRules((c) => ({ ...c, restartDelayMinutes: value }))} />
          <NumberField label="Max restart attempts per session" value={rules.maxAttemptsPerSession} min={0} max={20} onChange={(value) => setRules((c) => ({ ...c, maxAttemptsPerSession: value }))} />
          <NumberField label="Max restarts per day" value={rules.maxRestartsPerDayPerAccount} min={0} max={50} onChange={(value) => setRules((c) => ({ ...c, maxRestartsPerDayPerAccount: value }))} />
          <NumberField label="Max restarts per window" value={rules.maxRestartsPerWindowPerAccount} min={0} max={50} onChange={(value) => setRules((c) => ({ ...c, maxRestartsPerWindowPerAccount: value }))} />
          <ToggleField label="Yellow threshold" checked={rules.restartYellowAccounts} onChange={(checked) => setRules((c) => ({ ...c, restartYellowAccounts: checked }))} />
          <ToggleField label="Red threshold" checked={rules.restartRedAccounts} onChange={(checked) => setRules((c) => ({ ...c, restartRedAccounts: checked }))} />
          <ToggleField label="Respect fixed blackouts" checked={rules.respectPhoneRest} onChange={(checked) => setRules((c) => ({ ...c, respectPhoneRest: checked }))} />
          <ToggleField label="Respect 6-hour business window" checked={rules.respectSixHourWindow} onChange={(checked) => setRules((c) => ({ ...c, respectSixHourWindow: checked }))} />
        </div>
      </section>

      <section className="ig-ar-section">
        <h3>Safety and resume</h3>
        <div className="ig-ar-fields">
          <ToggleField label="Resume follow" checked={rules.resumeFollowIfQuotaRemaining} onChange={(checked) => setRules((c) => ({ ...c, resumeFollowIfQuotaRemaining: checked }))} />
          <ToggleField label="Resume unfollow" checked={rules.resumeUnfollowIfQuotaRemaining} onChange={(checked) => setRules((c) => ({ ...c, resumeUnfollowIfQuotaRemaining: checked }))} />
          <ToggleField label="Stop on challenge/checkpoint" checked={rules.blockOnChallenge} onChange={(checked) => setRules((c) => ({ ...c, blockOnChallenge: checked }))} />
          <ToggleField label="Stop on restriction/action block" checked={rules.blockOnRestriction} onChange={(checked) => setRules((c) => ({ ...c, blockOnRestriction: checked }))} />
          <ToggleField label="Stop on identity mismatch" checked={rules.blockOnAccountMismatch} onChange={(checked) => setRules((c) => ({ ...c, blockOnAccountMismatch: checked }))} />
          <ToggleField label="Stop on device/offline issue" checked={rules.blockOnDeviceOffline} onChange={(checked) => setRules((c) => ({ ...c, blockOnDeviceOffline: checked }))} />
          <ToggleField label="Notify on blocked restart" checked={rules.notifyOnBlockedRestart} onChange={(checked) => setRules((c) => ({ ...c, notifyOnBlockedRestart: checked }))} />
        </div>
      </section>

      {runtimeStatus ? (
        <section className="ig-ar-section ig-ar-runtime-strip">
          <h3>Runtime status</h3>
          <div className="ig-ar-runtime-grid">
            <RuntimeStat label="Eligible accounts" value={String(runtimeStatus.eligibleCount)} />
            <RuntimeStat label="Blocked accounts" value={String(runtimeStatus.blockedCount)} />
            <RuntimeStat label="Next evaluation" value={runtimeStatus.nextEvaluation ?? "Not scheduled"} />
            <RuntimeStat label="Last evaluation" value={runtimeStatus.lastEvaluation ?? "None"} />
          </div>
        </section>
      ) : null}

      <div className="ig-ar-editor-actions">
        <button type="button" className="ig-ar-save-btn" disabled={saveState === "saving" || !dirty} onClick={() => void handleSave()}>
          {saveState === "saving" ? "Saving…" : "Save settings"}
        </button>
        {saveState === "saved" ? <span className="ig-ar-inline-meta">Saved</span> : null}
        {saveState === "error" && errorMessage ? <span className="ig-ar-inline-meta ig-ar-inline-error">{errorMessage}</span> : null}
      </div>

      {enableConfirmOpen ? (
        <div className="ig-ar-confirm" role="dialog" aria-modal="true">
          <p>Enable Auto Restart in Production mode? Eligible accounts with active schedules will be evaluated on each tick.</p>
          <div className="ig-ar-confirm-actions">
            <button type="button" className="ig-ar-secondary-btn" onClick={() => setEnableConfirmOpen(false)}>Cancel</button>
            <button type="button" className="ig-ar-save-btn" onClick={() => void confirmEnable()}>Enable</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RuntimeStat({ label, value }: { label: string; value: string }) {
  return (
    <article className="ig-ar-runtime-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="ig-ar-field ig-ar-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
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
    </label>
  );
}
