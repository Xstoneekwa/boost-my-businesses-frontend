"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  addProfileAddonOptions,
  addProfilePackageOptions,
  addProfileRuntimeOptions,
  defaultAddProfileCommercialPackage,
  packageLabelForSelection,
} from "@/lib/instagram-dashboard/add-profile-packages";

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };
type AppInstance = {
  app_instance_id: string;
  instance_type: string;
  instance_index: number;
  label: string;
  package_name: string;
  status: string;
  current_account_id?: string | null;
  usable_for_auto_login: boolean;
  is_launchable: boolean;
  selectable: boolean;
};
type Device = Record<string, string | number | boolean | null | AppInstance[]> & {
  id: string;
  device_name: string;
  phone_name?: string | null;
  host_name?: string | null;
  status?: string | null;
  adb_serial?: string | null;
  adb_serial_display?: string | null;
  heartbeat_status?: string | null;
  heartbeat_warning?: string | null;
  phone_wide_availability?: string | null;
  next_window_label?: string | null;
  app_instances_available_count?: number | null;
  app_instances_occupied_count?: number | null;
  app_instances: AppInstance[];
};
type UsernameVerification = {
  status: string;
  canonical_username: string | null;
  avatar_url: string | null;
  reason: string;
};
type ScheduleSlot = {
  slot_index: number;
  slot_kind: string;
  slot_kind_label: string;
  local_label: string;
  starts_at: string;
  ends_at: string;
  available: boolean;
  reason: string | null;
  occupied_by: string | null;
};
type ScheduleSlotsResponse = {
  device_id: string;
  device_label: string;
  assignment_type: string;
  slot_date: string;
  timezone: string;
  slots: ScheduleSlot[];
};
type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;

const steps = ["Device", "Account", "App Instance", "Package & Add-ons", "Schedule", "Review"];

async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  const trimmedText = text.trim();
  if (!trimmedText) throw new Error(fallback);

  let payload: ApiEnvelope<T>;
  try {
    payload = JSON.parse(trimmedText) as ApiEnvelope<T>;
  } catch {
    throw new Error(response.ok ? fallback : `Request failed (${response.status}). ${fallback}`);
  }

  if (!response.ok || !payload.ok) {
    throw new Error(!payload.ok ? payload.error : `Request failed (${response.status}). ${fallback}`);
  }

  return payload.data;
}

function bestDefaultAppInstance(device: Device | undefined) {
  const instances = device?.app_instances ?? [];
  return (
    instances.find((app) => app.selectable && app.instance_type === "clone" && app.instance_index === 1) ||
    instances.find((app) => app.selectable && app.instance_type === "clone") ||
    instances.find((app) => app.selectable)
  );
}

function appInstanceDisabledReason(app: AppInstance, hasFreeClone: boolean) {
  if (!app.selectable) {
    if (app.current_account_id) return "Occupied";
    if (app.status !== "available") return app.status;
    if (!app.is_launchable) return "Not launchable";
    if (!app.usable_for_auto_login) return "Not usable for auto login";
    return "Unavailable";
  }
  if (app.instance_type === "primary_app" && hasFreeClone) return "Primary requires explicit override";
  return "";
}

export default function AddProfileWizard() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(0);
  const [devices, setDevices] = useState<Device[]>([]);
  const [scheduleSlots, setScheduleSlots] = useState<ScheduleSlotsResponse | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [verification, setVerification] = useState<UsernameVerification | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [form, setForm] = useState({
    device_id: "",
    app_instance_id: "",
    username: "",
    password: "",
    email: "",
    display_name: "",
    internal_label: "",
    notes: "",
    login_method: "manual",
    clone_mode: "off",
    template_mode: "default",
    template_id: "",
    commercial_package: defaultAddProfileCommercialPackage(),
    addons: [] as string[],
    runtime_mode: "safe_setup",
    starts_at: "",
    ends_at: "",
  });

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === form.device_id) ?? devices[0],
    [devices, form.device_id],
  );
  const selectedAppInstance = useMemo(
    () => selectedDevice?.app_instances.find((app) => app.app_instance_id === form.app_instance_id) ?? bestDefaultAppInstance(selectedDevice),
    [selectedDevice, form.app_instance_id],
  );
  const selectedPackage = useMemo(
    () => addProfilePackageOptions.find((pkg) => pkg.value === form.commercial_package) ?? addProfilePackageOptions[4],
    [form.commercial_package],
  );
  const selectedRuntime = useMemo(
    () => addProfileRuntimeOptions.find((plan) => plan.value === form.runtime_mode) ?? addProfileRuntimeOptions[0],
    [form.runtime_mode],
  );
  const selectedAddons = useMemo(
    () => addProfileAddonOptions.filter((addon) => form.addons.includes(addon.value)),
    [form.addons],
  );
  const selectedScheduleSlot = useMemo(
    () => scheduleSlots?.slots.find((slot) => slot.starts_at === form.starts_at && slot.ends_at === form.ends_at) ?? null,
    [scheduleSlots, form.starts_at, form.ends_at],
  );

  useEffect(() => {
    if (!isOpen) return;

    let ignore = false;
    setIsLoading(true);
    setError("");

    fetch("/api/instagram-dashboard/devices", { headers: { Accept: "application/json" } })
      .then((response) => readApiResponse<Device[]>(response, "Could not load devices."))
      .then((deviceRows) => {
        if (ignore) return;
        setDevices(deviceRows);
        setForm((current) => ({
          ...current,
          device_id: current.device_id || deviceRows[0]?.id || "",
          app_instance_id: current.app_instance_id || bestDefaultAppInstance(deviceRows.find((device) => device.id === (current.device_id || deviceRows[0]?.id)))?.app_instance_id || "",
        }));
      })
      .catch((loadError) => {
        if (!ignore) setError(loadError instanceof Error ? loadError.message : "Could not load profile setup data.");
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || step !== 4 || !selectedDevice?.id) return;

    let ignore = false;
    setIsLoadingSlots(true);
    setError("");
    fetch(`/api/instagram-dashboard/accounts/schedule-slots?device_id=${encodeURIComponent(selectedDevice.id)}&runtime_mode=${encodeURIComponent(form.runtime_mode)}`, {
      headers: { Accept: "application/json" },
    })
      .then((response) => readApiResponse<ScheduleSlotsResponse>(response, "Could not load schedule slots."))
      .then((slotResponse) => {
        if (ignore) return;
        setScheduleSlots(slotResponse);
        setForm((current) => {
          const currentStillAvailable = slotResponse.slots.some((slot) => slot.available && slot.starts_at === current.starts_at && slot.ends_at === current.ends_at);
          const firstAvailable = slotResponse.slots.find((slot) => slot.available);
          return {
            ...current,
            starts_at: currentStillAvailable ? current.starts_at : firstAvailable?.starts_at || "",
            ends_at: currentStillAvailable ? current.ends_at : firstAvailable?.ends_at || "",
          };
        });
      })
      .catch((loadError) => {
        if (!ignore) setError(loadError instanceof Error ? loadError.message : "Could not load schedule slots.");
      })
      .finally(() => {
        if (!ignore) setIsLoadingSlots(false);
      });

    return () => {
      ignore = true;
    };
  }, [form.runtime_mode, isOpen, selectedDevice?.id, step]);

  function updateField(key: keyof typeof form, value: string) {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === "runtime_mode" ? { starts_at: "", ends_at: "" } : {}),
    }));
    if (key === "username") setVerification(null);
    if (key === "runtime_mode") setScheduleSlots(null);
  }

  function selectDevice(device: Device) {
    setForm((current) => ({
      ...current,
      device_id: device.id,
      app_instance_id: bestDefaultAppInstance(device)?.app_instance_id || "",
      starts_at: "",
      ends_at: "",
    }));
    setScheduleSlots(null);
  }

  async function verifyUsername() {
    const username = form.username.trim();
    if (!username) return;
    setIsVerifying(true);
    setError("");
    try {
      const result = await readApiResponse<UsernameVerification>(
        await fetch(`/api/instagram-dashboard/accounts/verify?username=${encodeURIComponent(username)}`, {
          headers: { Accept: "application/json" },
        }),
        "Could not verify username.",
      );
      setVerification(result);
      if (result.status === "not_found" || result.status === "invalid_format") {
        setError(`Username verification blocked: ${result.reason || result.status}`);
      }
    } catch (verifyError) {
      setVerification({ status: "pending_verification", canonical_username: null, avatar_url: null, reason: "verification_unavailable" });
      setError(verifyError instanceof Error ? verifyError.message : "Could not verify username.");
    } finally {
      setIsVerifying(false);
    }
  }

  function closeWizard() {
    if (isSaving) return;
    setIsOpen(false);
    setShowConfirm(false);
    setStep(0);
    setError("");
    setSuccess("");
    setScheduleSlots(null);
  }

  function canMoveNext() {
    if (step === 0) return Boolean(selectedDevice);
    if (step === 1) return Boolean(form.username.trim()) && (form.login_method !== "credentials" || Boolean(form.password.trim()));
    if (step === 2) return Boolean(selectedAppInstance?.selectable);
    if (step === 3) return Boolean(form.commercial_package && form.runtime_mode && selectedPackage?.selectable);
    if (step === 4) return Boolean(selectedScheduleSlot?.available);
    return Boolean(selectedDevice && selectedAppInstance && selectedScheduleSlot?.available);
  }

  async function createProfile() {
    if (!selectedDevice || !selectedAppInstance) return;

    setIsSaving(true);
    setError("");
    setSuccess("");
    setShowConfirm(false);

    try {
      await readApiResponse(
        await fetch("/api/instagram-dashboard/accounts/create", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            ...form,
            device_name: selectedDevice.device_name,
            app_instance_id: selectedAppInstance.app_instance_id,
            clone_mode: selectedAppInstance.instance_type === "primary_app" ? "primary_app" : `clone_${selectedAppInstance.instance_index}`,
          }),
        }),
        "Could not create profile.",
      );
      setSuccess("Profile created with safe setup assignment. No login, provisioning, or run was launched.");
      router.refresh();
      setTimeout(closeWizard, 650);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create profile.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <button type="button" className="ig-add-profile-button" onClick={() => setIsOpen(true)}>
        <Plus aria-hidden="true" size={16} />
        Add Profile
      </button>

      {isOpen ? (
        <div className="ig-profile-overlay" role="presentation" onMouseDown={closeWizard}>
          <section className="ig-profile-modal" role="dialog" aria-modal="true" aria-labelledby="ig-profile-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="ig-profile-header">
              <div>
                <span>Add Profile</span>
                <h2 id="ig-profile-title">New Instagram Account</h2>
              </div>
              <button type="button" onClick={closeWizard} aria-label="Close Add Profile">x</button>
            </header>

            <div className="ig-profile-steps" aria-label="Profile setup progress">
              {steps.map((label, index) => (
                <span key={label} className={index <= step ? "ig-profile-step-active" : ""}>{label}</span>
              ))}
            </div>

            {error ? <p className="ig-profile-message ig-profile-error">{error}</p> : null}
            {success ? <p className="ig-profile-message ig-profile-success">{success}</p> : null}
            {isLoading ? <div className="ig-profile-loading">Loading setup data...</div> : null}

            {!isLoading ? (
              <div className="ig-profile-body">
                {step === 0 ? (
                  <div className="ig-profile-options">
                    {devices.map((device) => (
                      <button
                        key={device.id}
                        type="button"
                        className={form.device_id === device.id ? "ig-profile-option ig-profile-option-active" : "ig-profile-option"}
                        onClick={() => selectDevice(device)}
                      >
                        <strong>{device.device_name}</strong>
                        <span>{device.adb_serial || device.adb_serial_display || "adb unknown"} · {device.status || "offline"} · heartbeat {device.heartbeat_status || "unknown"}</span>
                        <span>{device.app_instances_available_count || 0} free app instances · {device.app_instances_occupied_count || 0} occupied</span>
                        {device.heartbeat_warning ? <em className="ig-profile-warning">{device.heartbeat_warning}</em> : null}
                      </button>
                    ))}
                  </div>
                ) : null}

                {step === 1 ? (
                  <div className="ig-profile-grid">
                    <ProfileField
                      label="Instagram username"
                      value={form.username}
                      onChange={(value) => updateField("username", value)}
                      trailingAction={<button type="button" className="ig-profile-inline-action" onClick={() => void verifyUsername()} disabled={isVerifying || !form.username.trim()}>{isVerifying ? "..." : "Verify"}</button>}
                    />
                    {form.login_method === "credentials" ? (
                      <ProfileField
                        label="Password (write-only)"
                        type="password"
                        value={form.password}
                        onChange={(value) => updateField("password", value)}
                      />
                    ) : (
                      <div className="ig-profile-note">
                        <strong>Manual login</strong>
                        <span>No credentials will be stored now. Provisioning stays manual and is not launched.</span>
                      </div>
                    )}
                    <ProfileField label="Email optional" value={form.email} onChange={(value) => updateField("email", value)} />
                    <ProfileField label="Display name optional" value={form.display_name} onChange={(value) => updateField("display_name", value)} />
                    <ProfileField label="Internal label optional" value={form.internal_label} onChange={(value) => updateField("internal_label", value)} />
                    <label className="ig-profile-field">
                      <span>Login method</span>
                      <select value={form.login_method} onChange={(event) => updateField("login_method", event.target.value)}>
                        <option value="manual">manual</option>
                        <option value="credentials">credentials</option>
                      </select>
                      <small>{form.login_method === "credentials" ? "Password is submitted write-only to the secure credentials API." : "No password is collected; login/provisioning is a later manual step."}</small>
                    </label>
                    {verification ? (
                      <div className="ig-profile-verification">
                        {verification.avatar_url ? <span className="ig-profile-avatar-preview" style={{ backgroundImage: `url(${verification.avatar_url})` }} aria-hidden="true" /> : <span className="ig-profile-avatar-placeholder">No avatar</span>}
                        <div>
                          <strong>{verification.canonical_username || form.username || "Verification pending"}</strong>
                          <span>{verification.status} · {verification.reason}</span>
                        </div>
                      </div>
                    ) : null}
                    <label className="ig-profile-field ig-profile-field-wide">
                      <span>Notes optional</span>
                      <textarea value={form.notes} rows={4} onChange={(event) => updateField("notes", event.target.value)} />
                    </label>
                  </div>
                ) : null}

                {step === 2 ? (
                  <div className="ig-profile-options">
                    {(selectedDevice?.app_instances ?? []).map((app) => {
                      const hasFreeClone = Boolean(selectedDevice?.app_instances.some((candidate) => candidate.selectable && candidate.instance_type === "clone"));
                      const disabledReason = appInstanceDisabledReason(app, hasFreeClone);
                      return (
                      <button
                        key={app.app_instance_id}
                        type="button"
                        className={form.app_instance_id === app.app_instance_id ? "ig-profile-option ig-profile-option-active" : "ig-profile-option"}
                        onClick={() => updateField("app_instance_id", app.app_instance_id)}
                        disabled={Boolean(disabledReason)}
                      >
                        <strong>{app.label}</strong>
                        <span>index {app.instance_index} · {app.package_name || "package unknown"}</span>
                        <span>{app.status}{app.current_account_id ? ` · occupied by ${app.current_account_id}` : ""}</span>
                        {disabledReason ? <em className="ig-profile-warning">{disabledReason}</em> : null}
                      </button>
                      );
                    })}
                  </div>
                ) : null}

                {step === 3 ? (
                  <div className="ig-profile-package-step">
                    <section className="ig-profile-section">
                      <h3>Package</h3>
                      <div className="ig-profile-grid">
                        {addProfilePackageOptions.map((pkg) => (
                          <button
                            key={pkg.value}
                            type="button"
                            className={form.commercial_package === pkg.value ? "ig-profile-option ig-profile-option-active" : "ig-profile-option"}
                            onClick={() => updateField("commercial_package", pkg.value)}
                            disabled={!pkg.selectable}
                          >
                            <strong>{pkg.label}</strong>
                            <span>{pkg.detail}</span>
                            {pkg.planned ? <em className="ig-profile-warning">Planned</em> : null}
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="ig-profile-section">
                      <h3>Runtime mode</h3>
                      <div className="ig-profile-grid">
                        {addProfileRuntimeOptions.map((plan) => (
                          <button
                            key={plan.value}
                            type="button"
                            className={form.runtime_mode === plan.value ? "ig-profile-option ig-profile-option-active" : "ig-profile-option"}
                            onClick={() => updateField("runtime_mode", plan.value)}
                          >
                            <strong>{plan.label}</strong>
                            <span>{plan.detail}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="ig-profile-section">
                      <h3>Add-ons</h3>
                      <div className="ig-profile-grid">
                        {addProfileAddonOptions.map((addon) => (
                          <button
                            key={addon.value}
                            type="button"
                            className={form.addons.includes(addon.value) ? "ig-profile-option ig-profile-option-active" : "ig-profile-option"}
                            onClick={() => setForm((current) => ({
                              ...current,
                              addons: current.addons.includes(addon.value)
                                ? current.addons.filter((code) => code !== addon.value)
                                : [...current.addons, addon.value],
                            }))}
                            disabled={!addon.wired}
                          >
                            <strong>{addon.label}</strong>
                            <span>{addon.wired ? "Included when wired" : "Planned · not wired yet"}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                    <p className="ig-profile-message">No package or add-on launches login, provisioning, runner, DM, follow, or unfollow.</p>
                  </div>
                ) : null}

                {step === 4 ? (
                  <div>
                    {isLoadingSlots ? <div className="ig-profile-loading">Loading phone schedule slots...</div> : null}
                    <div className="ig-profile-options">
                      {(scheduleSlots?.slots ?? []).map((slot) => (
                        <button
                          key={`${slot.starts_at}:${slot.ends_at}`}
                          type="button"
                          className={form.starts_at === slot.starts_at && form.ends_at === slot.ends_at ? "ig-profile-option ig-profile-option-active" : "ig-profile-option"}
                          onClick={() => setForm((current) => ({ ...current, starts_at: slot.starts_at, ends_at: slot.ends_at }))}
                          disabled={!slot.available}
                        >
                          <strong>{slot.local_label || `Slot ${slot.slot_index}`}</strong>
                          <span>{slot.slot_kind_label || slot.slot_kind} · {scheduleSlots?.timezone || "UTC"}</span>
                          <span>{slot.available ? "available" : slot.occupied_by ? `occupied by @${slot.occupied_by}` : slot.reason || "unavailable"}</span>
                        </button>
                      ))}
                    </div>
                    {!isLoadingSlots && !scheduleSlots?.slots.length ? (
                      <p className="ig-profile-message ig-profile-error">No schedule slots are available for this phone.</p>
                    ) : null}
                  </div>
                ) : null}

                {step === 5 ? (
                  <dl className="ig-profile-review">
                    <div><dt>Username</dt><dd>{verification?.canonical_username || form.username || "—"} · {verification?.status || "pending_verification"}</dd></div>
                    <div><dt>Avatar</dt><dd>{verification?.avatar_url ? "avatar preview ready" : "pending / unavailable"}</dd></div>
                    <div><dt>Device</dt><dd>{selectedDevice?.device_name || "—"} · {selectedDevice?.adb_serial || selectedDevice?.adb_serial_display || "adb unknown"}</dd></div>
                    <div><dt>Device status</dt><dd>{selectedDevice?.status || "unknown"} · heartbeat {selectedDevice?.heartbeat_status || "unknown"}</dd></div>
                    <div><dt>App instance</dt><dd>{selectedAppInstance?.label || "—"} · index {selectedAppInstance?.instance_index ?? "—"}</dd></div>
                    <div><dt>Package</dt><dd>{selectedAppInstance?.package_name || "—"} · {selectedAppInstance?.status || "unknown"}</dd></div>
                    <div><dt>Login method</dt><dd>{form.login_method} · credentials {form.login_method === "credentials" ? "write-only" : "not submitted"}</dd></div>
                    <div><dt>Package</dt><dd>{packageLabelForSelection(form.commercial_package as typeof form.commercial_package)} · settings source: commercial package defaults</dd></div>
                    <div><dt>Runtime mode</dt><dd>{selectedRuntime.label}</dd></div>
                    <div><dt>Add-ons</dt><dd>{selectedAddons.length ? selectedAddons.map((addon) => addon.label).join(", ") : "none"} · planned add-ons are not wired to runtime</dd></div>
                    <div><dt>Quotas preview</dt><dd>Package caps apply after assignment; no runtime quota is activated from Add Profile.</dd></div>
                    <div><dt>Entitlements preview</dt><dd>{selectedPackage.commercialCode} · subscription type follows runtime mode · no auto entitlement run</dd></div>
                    <div><dt>Schedule</dt><dd>{selectedScheduleSlot?.local_label || "—"} · {scheduleSlots?.timezone || "UTC"} · visible later in Schedule drawer</dd></div>
                    <div><dt>Safety</dt><dd>No login, provisioning, runner, DM, Welcome, Outreach or Unfollow is launched.</dd></div>
                    <div><dt>No run auto</dt><dd>Provisioning, login, and runner stay off.</dd></div>
                    <div><dt>No login/provisioning auto</dt><dd>Credentials remain write-only when selected; no device login is started.</dd></div>
                    <div><dt>Primary app</dt><dd>Unaffected unless explicitly selected; occupied instances are disabled.</dd></div>
                  </dl>
                ) : null}
              </div>
            ) : null}

            <footer className="ig-profile-actions">
              <button type="button" className="ig-profile-secondary" onClick={step === 0 ? closeWizard : () => setStep((current) => (current - 1) as WizardStep)} disabled={isSaving}>
                {step === 0 ? "Cancel" : "Previous"}
              </button>
              {step < 5 ? (
                <button type="button" className="ig-profile-primary" onClick={() => setStep((current) => (current + 1) as WizardStep)} disabled={!canMoveNext() || isSaving}>
                  Next
                </button>
              ) : (
                <button type="button" className="ig-profile-primary" onClick={() => setShowConfirm(true)} disabled={isSaving || !canMoveNext()}>
                  Create Profile
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}

      {showConfirm ? (
        <div className="ig-profile-overlay" role="presentation" onMouseDown={() => setShowConfirm(false)}>
          <section className="ig-profile-confirm" role="dialog" aria-modal="true" aria-labelledby="ig-profile-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <h3 id="ig-profile-confirm-title">Create this profile?</h3>
            <p>This creates the account, optional write-only credentials, and an explicit app-instance assignment. It does not launch login, provisioning, or a run.</p>
            <div className="ig-profile-actions">
              <button type="button" className="ig-profile-secondary" onClick={() => setShowConfirm(false)} disabled={isSaving}>Cancel</button>
              <button type="button" className="ig-profile-primary" onClick={() => void createProfile()} disabled={isSaving}>{isSaving ? "Creating..." : "Create Profile"}</button>
            </div>
          </section>
        </div>
      ) : null}

      <style>{`
        .ig-add-profile-button,
        .ig-profile-primary,
        .ig-profile-secondary {
          min-height: 34px;
          border-radius: 999px;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          transition: opacity .13s ease, border-color .13s ease, color .13s ease, background .13s ease;
        }

        /* ── Trigger button in the tab toolbar ── */
        .ig-add-profile-button {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid rgba(101,88,245,0.40);
          background: #6558f5;
          color: #fff;
          padding: 0 13px;
        }
        .ig-add-profile-button:hover { opacity: .88; }

        /* ── Overlay ── */
        .ig-profile-overlay {
          position: fixed;
          inset: 0;
          z-index: 190;
          display: grid;
          place-items: center;
          padding: 18px;
          background: rgba(0,0,0,0.75);
          backdrop-filter: blur(4px);
        }

        /* ── Modal / Confirm card ── */
        .ig-profile-modal,
        .ig-profile-confirm {
          width: min(100%, 760px);
          max-height: min(90vh, 760px);
          overflow-y: auto;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: #161820;
          color: #f0f0ee;
          box-shadow: 0 8px 32px -8px rgba(0,0,0,.6);
          padding: 22px;
        }

        .ig-profile-confirm {
          width: min(100%, 440px);
        }

        /* ── Header ── */
        .ig-profile-header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
          padding-bottom: 16px;
          border-bottom: 1px solid rgba(255,255,255,.07);
        }

        .ig-profile-header span,
        .ig-profile-field span,
        .ig-profile-review dt {
          display: block;
          color: #4a4f5c;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 500;
          letter-spacing: .1em;
          text-transform: uppercase;
        }

        .ig-profile-header h2,
        .ig-profile-confirm h3 {
          color: #f0f0ee;
          font-size: 17px;
          font-weight: 700;
          letter-spacing: -.01em;
          margin: 4px 0 0;
        }

        .ig-profile-header button {
          width: 28px;
          height: 28px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 6px;
          background: #1e2028;
          color: #8a8f98;
          cursor: pointer;
          font-size: 16px;
          display: grid;
          place-items: center;
          transition: border-color .13s ease, color .13s ease, background .13s ease;
        }
        .ig-profile-header button:hover {
          border-color: rgba(248,113,113,0.28);
          color: #f87171;
          background: rgba(220,38,38,0.13);
        }

        /* ── Step progress bar ── */
        .ig-profile-steps {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 6px;
          margin-bottom: 18px;
        }

        .ig-profile-steps span {
          min-height: 28px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 999px;
          color: #4a4f5c;
          display: grid;
          place-items: center;
          font-size: 11px;
          font-weight: 600;
        }

        .ig-profile-steps .ig-profile-step-active {
          border-color: rgba(101,88,245,0.35);
          background: rgba(101,88,245,0.18);
          color: #a594f9;
        }

        /* ── Package step ── */
        .ig-profile-package-step {
          display: grid;
          gap: 16px;
        }

        .ig-profile-section h3 {
          margin: 0 0 10px;
          font-size: 11px;
          letter-spacing: .1em;
          text-transform: uppercase;
          color: #4a4f5c;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 500;
        }

        /* ── Grids ── */
        .ig-profile-grid,
        .ig-profile-options,
        .ig-profile-review {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        /* ── Option cards + form inputs ── */
        .ig-profile-option,
        .ig-profile-field input,
        .ig-profile-field select,
        .ig-profile-field textarea {
          width: 100%;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: #1e2028;
          color: #f0f0ee;
          font: inherit;
          outline: none;
          padding: 11px 12px;
          transition: border-color .13s ease;
        }
        .ig-profile-field input:focus,
        .ig-profile-field select:focus,
        .ig-profile-field textarea:focus { border-color: rgba(101,88,245,.35); }

        .ig-profile-option {
          min-height: 70px;
          cursor: pointer;
          text-align: left;
        }
        .ig-profile-option:hover:not(:disabled) { border-color: rgba(255,255,255,.14); }

        .ig-profile-option strong,
        .ig-profile-review dd {
          color: #f0f0ee;
          margin: 0;
          font-weight: 600;
        }

        .ig-profile-option span {
          display: block;
          color: #8a8f98;
          font-size: 11.5px;
          margin-top: 4px;
        }

        .ig-profile-option-active {
          border-color: rgba(101,88,245,0.35);
          background: rgba(101,88,245,0.14);
        }

        /* ── Field layout ── */
        .ig-profile-field { display: grid; gap: 8px; }
        .ig-profile-input-wrap { position: relative; }
        .ig-profile-field-wide { grid-column: 1 / -1; }

        /* ── Review step ── */
        .ig-profile-review { margin: 0; }

        .ig-profile-review div {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: #1e2028;
          padding: 11px 12px;
        }

        .ig-profile-review dd {
          margin-top: 5px;
          overflow-wrap: anywhere;
          color: #f0f0ee;
        }

        /* ── Footer actions ── */
        .ig-profile-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 16px;
        }

        .ig-profile-primary {
          border: 1px solid rgba(101,88,245,0.40);
          background: #6558f5;
          color: #fff;
          padding: 0 16px;
        }
        .ig-profile-primary:hover:not(:disabled) { opacity: .88; }

        .ig-profile-secondary {
          border: 1px solid rgba(255,255,255,.07);
          background: #1e2028;
          color: #8a8f98;
          padding: 0 16px;
        }
        .ig-profile-secondary:hover:not(:disabled) {
          border-color: rgba(255,255,255,.18);
          color: #f0f0ee;
        }

        .ig-profile-primary:disabled,
        .ig-profile-secondary:disabled,
        .ig-profile-option:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }

        /* ── Warning badge (kept amber — semantic) ── */
        .ig-profile-warning {
          display: block;
          color: #fbbf24;
          font-size: 11px;
          font-style: normal;
          font-weight: 700;
          margin-top: 6px;
        }

        /* ── Note + verification card ── */
        .ig-profile-note,
        .ig-profile-verification {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 8px;
          background: #1e2028;
          color: #8a8f98;
          padding: 12px;
        }

        .ig-profile-note { display: grid; gap: 6px; }

        .ig-profile-field small {
          color: #8a8f98;
          font-size: 12px;
          line-height: 1.4;
        }

        /* ── Inline "Verify" action button ── */
        .ig-profile-inline-action {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          border: 1px solid rgba(101,88,245,0.35);
          border-radius: 999px;
          background: rgba(101,88,245,0.14);
          color: #a594f9;
          cursor: pointer;
          font-size: 11px;
          font-weight: 700;
          padding: 4px 9px;
          transition: background .13s ease;
        }
        .ig-profile-inline-action:hover:not(:disabled) { background: rgba(101,88,245,0.24); }

        /* ── Verification preview ── */
        .ig-profile-verification { display: flex; align-items: center; gap: 10px; }

        .ig-profile-avatar-preview,
        .ig-profile-avatar-placeholder {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          object-fit: cover;
          flex-shrink: 0;
        }

        .ig-profile-avatar-preview {
          display: block;
          background-position: center;
          background-size: cover;
        }

        .ig-profile-avatar-placeholder {
          display: grid;
          place-items: center;
          background: #252832;
          color: #8a8f98;
          font-size: 9px;
          text-align: center;
        }

        /* ── Messages ── */
        .ig-profile-message,
        .ig-profile-loading {
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          margin: 0 0 14px;
          padding: 10px 12px;
        }

        .ig-profile-error {
          border: 1px solid rgba(248,113,113,0.28);
          background: rgba(248,113,113,0.08);
          color: #fca5a5;
        }

        .ig-profile-success {
          border: 1px solid rgba(52,211,153,0.24);
          background: rgba(52,211,153,0.08);
          color: #86efac;
        }

        .ig-profile-loading,
        .ig-profile-confirm p {
          color: #8a8f98;
        }

        @media (max-width: 720px) {
          .ig-profile-grid,
          .ig-profile-options,
          .ig-profile-review,
          .ig-profile-steps {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}

function ProfileField({
  label,
  type = "text",
  value,
  onChange,
  trailingAction,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  trailingAction?: ReactNode;
}) {
  return (
    <label className="ig-profile-field">
      <span>{label}</span>
      <div className="ig-profile-input-wrap">
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
        {trailingAction}
      </div>
    </label>
  );
}
