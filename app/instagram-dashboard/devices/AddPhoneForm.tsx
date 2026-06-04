"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };
type AddPhoneResult = {
  device_id: string;
  display_name: string;
  adb_serial: string;
  app_instances_created_count: number;
  app_instances_existing_count: number;
  warnings: string[];
};

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

export default function AddPhoneForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [adbSerial, setAdbSerial] = useState("");
  const [model, setModel] = useState("");
  const [product, setProduct] = useState("");
  const [device, setDevice] = useState("");
  const [pool, setPool] = useState<"full_cycle" | "outreach_only">("full_cycle");
  const [maxClones, setMaxClones] = useState("3");
  const [hubLabel, setHubLabel] = useState("");
  const [hubPort, setHubPort] = useState("");
  const [hostLabel, setHostLabel] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<AddPhoneResult | null>(null);

  async function submitPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setSuccess(null);

    try {
      const result = await readApiResponse<AddPhoneResult>(
        await fetch("/api/instagram-dashboard/devices/add-phone", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            display_name: displayName,
            adb_serial: adbSerial,
            model,
            product,
            device,
            pool,
            max_clones: Number(maxClones) || 3,
            hub_label: hubLabel,
            hub_port: hubPort,
            host_label: hostLabel,
            packages_mode: "standard_instagram_4_packages",
          }),
        }),
        "Could not add phone.",
      );

      setDisplayName("");
      setAdbSerial("");
      setModel("");
      setProduct("");
      setDevice("");
      setPool("full_cycle");
      setMaxClones("3");
      setHubLabel("");
      setHubPort("");
      setHostLabel("");
      setSuccess(result);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not add phone.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="ig-add-phone-form" onSubmit={submitPhone}>
      <div className="ig-add-phone-grid">
        <label className="ig-add-phone-field">
          <span>Display name</span>
          <input
            required
            maxLength={80}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Samsung A16-03"
          />
        </label>
        <label className="ig-add-phone-field">
          <span>ADB serial</span>
          <input
            required
            maxLength={120}
            value={adbSerial}
            onChange={(event) => setAdbSerial(event.target.value)}
            placeholder="RFGL145VCKE"
          />
        </label>
        <label className="ig-add-phone-field">
          <span>Pool</span>
          <select value={pool} onChange={(event) => setPool(event.target.value as "full_cycle" | "outreach_only")}>
            <option value="full_cycle">full_cycle</option>
            <option value="outreach_only">outreach_only</option>
          </select>
        </label>
        <label className="ig-add-phone-field">
          <span>Model</span>
          <input maxLength={80} value={model} onChange={(event) => setModel(event.target.value)} placeholder="SM-A165F" />
        </label>
        <label className="ig-add-phone-field">
          <span>Product</span>
          <input maxLength={80} value={product} onChange={(event) => setProduct(event.target.value)} placeholder="a16nsxx" />
        </label>
        <label className="ig-add-phone-field">
          <span>Device</span>
          <input maxLength={80} value={device} onChange={(event) => setDevice(event.target.value)} placeholder="a16" />
        </label>
        <label className="ig-add-phone-field">
          <span>Max clones</span>
          <input
            min={3}
            max={16}
            type="number"
            value={maxClones}
            onChange={(event) => setMaxClones(event.target.value)}
          />
        </label>
        <label className="ig-add-phone-field">
          <span>Hub label</span>
          <input maxLength={80} value={hubLabel} onChange={(event) => setHubLabel(event.target.value)} placeholder="hub-a" />
        </label>
        <label className="ig-add-phone-field">
          <span>Hub port</span>
          <input maxLength={80} value={hubPort} onChange={(event) => setHubPort(event.target.value)} placeholder="1" />
        </label>
      </div>

      <label className="ig-add-phone-field">
        <span>Host label</span>
        <input maxLength={80} value={hostLabel} onChange={(event) => setHostLabel(event.target.value)} placeholder="prod-mac-hub-01" />
      </label>

      <div className="ig-add-phone-actions">
        <button type="submit" disabled={isSaving || !displayName.trim() || !adbSerial.trim()}>
          {isSaving ? "Adding..." : "Add phone"}
        </button>
        <small>Registers DB inventory only. No ADB detection, clone creation, assignment, run, login, or credentials.</small>
      </div>

      {error ? <p className="ig-add-phone-message ig-add-phone-error">{error}</p> : null}
      {success ? (
        <div className="ig-add-phone-message ig-add-phone-success">
          <strong>Phone added: {success.display_name || success.adb_serial}</strong>
          <span>Device ID: {success.device_id || "unknown"}</span>
          <span>ADB serial: {success.adb_serial}</span>
          <span>
            App instances: {success.app_instances_created_count} created · {success.app_instances_existing_count} existing
          </span>
          {success.warnings.length ? <span>Warnings: {success.warnings.join(", ")}</span> : null}
        </div>
      ) : null}
    </form>
  );
}
