"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };
type Device = Record<string, string | number | boolean | null> & {
  id: string;
  device_name: string;
  phone_name?: string | null;
  host_name?: string | null;
  status?: string | null;
};
type Template = Record<string, unknown> & {
  id: string;
  name: string;
  template_type: string;
  is_default?: boolean;
};
type WizardStep = 0 | 1 | 2 | 3 | 4;

const steps = ["Device", "Account", "Clone", "Template", "Review"];
const cloneOptions = [
  { value: "off", label: "Clone OFF" },
  { value: "dual_app_normal", label: "Dual App Normal" },
  { value: "dual_app_popup", label: "Dual App Popup" },
  { value: "dual_app_no_popup", label: "Dual App No Popup" },
  { value: "custom_package_later", label: "Custom package later placeholder" },
];

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

export default function AddProfileWizard() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(0);
  const [devices, setDevices] = useState<Device[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [form, setForm] = useState({
    device_id: "",
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
  });

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === form.device_id) ?? devices[0],
    [devices, form.device_id],
  );
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === form.template_id) ?? templates.find((template) => template.is_default),
    [templates, form.template_id],
  );

  useEffect(() => {
    if (!isOpen) return;

    let ignore = false;
    setIsLoading(true);
    setError("");

    Promise.all([
      fetch("/api/instagram-dashboard/devices", { headers: { Accept: "application/json" } }).then((response) => readApiResponse<Device[]>(response, "Could not load devices.")),
      fetch("/api/instagram-dashboard/templates", { headers: { Accept: "application/json" } }).then((response) => readApiResponse<Template[]>(response, "Could not load templates.")),
    ])
      .then(([deviceRows, templateRows]) => {
        if (ignore) return;
        setDevices(deviceRows);
        setTemplates(templateRows);
        setForm((current) => ({
          ...current,
          device_id: current.device_id || deviceRows[0]?.id || "",
          template_id: current.template_id || templateRows.find((template) => template.is_default)?.id || "",
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

  function updateField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function closeWizard() {
    if (isSaving) return;
    setIsOpen(false);
    setShowConfirm(false);
    setStep(0);
    setError("");
    setSuccess("");
  }

  function canMoveNext() {
    if (step === 0) return Boolean(selectedDevice);
    if (step === 1) return Boolean(form.username.trim());
    return true;
  }

  async function createProfile() {
    if (!selectedDevice) return;

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
          }),
        }),
        "Could not create profile.",
      );
      setSuccess("Profile created.");
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
                        onClick={() => updateField("device_id", device.id)}
                      >
                        <strong>{device.device_name}</strong>
                        <span>{device.phone_name || device.host_name || "Device assignment"} · {device.status || "offline"}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {step === 1 ? (
                  <div className="ig-profile-grid">
                    <ProfileField label="Instagram username" value={form.username} onChange={(value) => updateField("username", value)} />
                    <ProfileField
                      label="Password"
                      type="password"
                      value={form.password}
                      onChange={(value) => updateField("password", value)}
                    />
                    <ProfileField label="Email optional" value={form.email} onChange={(value) => updateField("email", value)} />
                    <ProfileField label="Display name optional" value={form.display_name} onChange={(value) => updateField("display_name", value)} />
                    <ProfileField label="Internal label optional" value={form.internal_label} onChange={(value) => updateField("internal_label", value)} />
                    <label className="ig-profile-field">
                      <span>Login method</span>
                      <select value={form.login_method} onChange={(event) => updateField("login_method", event.target.value)}>
                        <option value="manual">manual</option>
                        <option value="credentials">credentials</option>
                      </select>
                    </label>
                    <label className="ig-profile-field ig-profile-field-wide">
                      <span>Notes optional</span>
                      <textarea value={form.notes} rows={4} onChange={(event) => updateField("notes", event.target.value)} />
                    </label>
                  </div>
                ) : null}

                {step === 2 ? (
                  <div className="ig-profile-options">
                    {cloneOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={form.clone_mode === option.value ? "ig-profile-option ig-profile-option-active" : "ig-profile-option"}
                        onClick={() => updateField("clone_mode", option.value)}
                      >
                        <strong>{option.label}</strong>
                        <span>{option.value}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {step === 3 ? (
                  <div className="ig-profile-grid">
                    {["default", "selected", "scratch"].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={form.template_mode === mode ? "ig-profile-option ig-profile-option-active" : "ig-profile-option"}
                        onClick={() => updateField("template_mode", mode)}
                      >
                        <strong>{mode === "default" ? "Use default template" : mode === "selected" ? "Select existing template" : "Start from scratch"}</strong>
                      </button>
                    ))}
                    {form.template_mode === "selected" ? (
                      <label className="ig-profile-field ig-profile-field-wide">
                        <span>Template</span>
                        <select value={form.template_id} onChange={(event) => updateField("template_id", event.target.value)}>
                          {templates.map((template) => (
                            <option key={template.id} value={template.id}>{template.name} · {template.template_type}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                ) : null}

                {step === 4 ? (
                  <dl className="ig-profile-review">
                    <div><dt>Username</dt><dd>{form.username || "—"}</dd></div>
                    <div><dt>Device</dt><dd>{selectedDevice?.device_name || "—"}</dd></div>
                    <div><dt>Clone mode</dt><dd>{form.clone_mode}</dd></div>
                    <div><dt>Login method</dt><dd>{form.login_method}</dd></div>
                    <div><dt>Selected template</dt><dd>{form.template_mode === "scratch" ? "Start from scratch" : selectedTemplate?.name || "Default Safe Setup"}</dd></div>
                    <div><dt>Dry run enabled</dt><dd>true</dd></div>
                    <div><dt>Estimated mode</dt><dd>safe setup</dd></div>
                  </dl>
                ) : null}
              </div>
            ) : null}

            <footer className="ig-profile-actions">
              <button type="button" className="ig-profile-secondary" onClick={step === 0 ? closeWizard : () => setStep((current) => (current - 1) as WizardStep)} disabled={isSaving}>
                {step === 0 ? "Cancel" : "Previous"}
              </button>
              {step < 4 ? (
                <button type="button" className="ig-profile-primary" onClick={() => setStep((current) => (current + 1) as WizardStep)} disabled={!canMoveNext() || isSaving}>
                  Next
                </button>
              ) : (
                <button type="button" className="ig-profile-primary" onClick={() => setShowConfirm(true)} disabled={isSaving || !form.username.trim()}>
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
            <h3 id="ig-profile-confirm-title">🚨 Create this profile? ⚠️</h3>
            <p>This will create an Instagram Account with safe setup defaults and dry run enabled.</p>
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
          min-height: 38px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
        }

        .ig-add-profile-button {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid rgba(245,158,11,0.48);
          background: #F59E0B;
          color: #160b02;
          padding: 0 14px;
        }

        .ig-profile-overlay {
          position: fixed;
          inset: 0;
          z-index: 190;
          display: grid;
          place-items: center;
          padding: 18px;
          background: rgba(2,6,23,0.72);
          backdrop-filter: blur(12px);
        }

        .ig-profile-modal,
        .ig-profile-confirm {
          width: min(100%, 760px);
          max-height: min(90vh, 760px);
          overflow-y: auto;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 16px;
          background: #07111f;
          color: #f0f0ef;
          box-shadow: 0 24px 90px rgba(0,0,0,0.46);
          padding: 22px;
        }

        .ig-profile-confirm {
          width: min(100%, 440px);
        }

        .ig-profile-header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }

        .ig-profile-header span,
        .ig-profile-field span,
        .ig-profile-review dt {
          display: block;
          color: rgba(255,255,255,0.42);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .ig-profile-header h2,
        .ig-profile-confirm h3 {
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          margin: 6px 0 0;
        }

        .ig-profile-header button {
          width: 36px;
          height: 36px;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 10px;
          background: rgba(255,255,255,0.05);
          color: rgba(255,255,255,0.72);
          cursor: pointer;
          font-size: 22px;
        }

        .ig-profile-steps {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 18px;
        }

        .ig-profile-steps span {
          min-height: 30px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
          color: rgba(255,255,255,0.48);
          display: grid;
          place-items: center;
          font-size: 11px;
          font-weight: 900;
        }

        .ig-profile-steps .ig-profile-step-active {
          border-color: rgba(245,158,11,0.42);
          background: rgba(245,158,11,0.14);
          color: #FBBF24;
        }

        .ig-profile-grid,
        .ig-profile-options,
        .ig-profile-review {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .ig-profile-option,
        .ig-profile-field input,
        .ig-profile-field select,
        .ig-profile-field textarea {
          width: 100%;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 12px;
          background: rgba(255,255,255,0.045);
          color: #f0f0ef;
          font: inherit;
          outline: none;
          padding: 12px;
        }

        .ig-profile-option {
          min-height: 74px;
          cursor: pointer;
          text-align: left;
        }

        .ig-profile-option strong,
        .ig-profile-review dd {
          color: #f0f0ef;
          margin: 0;
        }

        .ig-profile-option span {
          display: block;
          color: rgba(255,255,255,0.52);
          font-size: 12px;
          margin-top: 5px;
        }

        .ig-profile-option-active {
          border-color: rgba(245,158,11,0.46);
          background: rgba(245,158,11,0.13);
        }

        .ig-profile-field {
          display: grid;
          gap: 8px;
        }

        .ig-profile-input-wrap {
          position: relative;
        }

        .ig-profile-field-wide {
          grid-column: 1 / -1;
        }

        .ig-profile-review {
          margin: 0;
        }

        .ig-profile-review div {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          background: rgba(255,255,255,0.035);
          padding: 12px;
        }

        .ig-profile-review dd {
          margin-top: 6px;
          overflow-wrap: anywhere;
        }

        .ig-profile-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 18px;
        }

        .ig-profile-primary {
          border: 1px solid rgba(245,158,11,0.50);
          background: #F59E0B;
          color: #160b02;
          padding: 0 16px;
        }

        .ig-profile-secondary {
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.045);
          color: rgba(255,255,255,0.76);
          padding: 0 16px;
        }

        .ig-profile-primary:disabled,
        .ig-profile-secondary:disabled {
          cursor: not-allowed;
          opacity: 0.58;
        }

        .ig-profile-message,
        .ig-profile-loading {
          border-radius: 12px;
          font-size: 13px;
          font-weight: 800;
          margin: 0 0 14px;
          padding: 11px 12px;
        }

        .ig-profile-error {
          border: 1px solid rgba(248,113,113,0.28);
          background: rgba(248,113,113,0.08);
          color: #FCA5A5;
        }

        .ig-profile-success {
          border: 1px solid rgba(52,211,153,0.24);
          background: rgba(52,211,153,0.08);
          color: #86EFAC;
        }

        .ig-profile-loading,
        .ig-profile-confirm p {
          color: rgba(255,255,255,0.62);
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
