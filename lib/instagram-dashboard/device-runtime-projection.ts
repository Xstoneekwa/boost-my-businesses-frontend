export type DeviceRuntimeProjectionSource =
  | "active_run_request"
  | "active_ig_run"
  | "runtime_indicator"
  | "heartbeat"
  | "none";

export type DeviceRuntimeProjectionInput = {
  phoneStatus?: string | null;
  activeRunRequestStatus?: string | null;
  activeRunRequestCancelRequestedAt?: string | null;
  activeRunStatus?: string | null;
  runtimeIndicatorState?: string | null;
};

export type DeviceRuntimeProjection = {
  deviceRuntimeActive: boolean;
  deviceRuntimeProjectionSource: DeviceRuntimeProjectionSource;
  device_runtime_projection_source: DeviceRuntimeProjectionSource;
  deviceRuntimeProjectionReason: string;
  device_runtime_projection_reason: string;
  projectedPhoneStatus: string | null;
};

const activeRunRequestStatuses = new Set([
  "pending",
  "queued",
  "claimed",
  "starting",
  "running",
  "stopping",
  "canceling",
  "cancel_requested",
]);

const activeRunStatuses = new Set(["pending", "running", "stopping"]);
const activeHeartbeatStatuses = new Set(["busy", "running", "active"]);

function normalize(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function projection(source: DeviceRuntimeProjectionSource, reason: string, phoneStatus: string | null): DeviceRuntimeProjection {
  const active = source !== "none";
  return {
    deviceRuntimeActive: active,
    deviceRuntimeProjectionSource: source,
    device_runtime_projection_source: source,
    deviceRuntimeProjectionReason: reason,
    device_runtime_projection_reason: reason,
    projectedPhoneStatus: active ? "running" : phoneStatus,
  };
}

export function projectDeviceRuntimeState(input: DeviceRuntimeProjectionInput): DeviceRuntimeProjection {
  const requestStatus = normalize(input.activeRunRequestStatus);
  if (activeRunRequestStatuses.has(requestStatus) || Boolean(input.activeRunRequestCancelRequestedAt)) {
    return projection("active_run_request", requestStatus || "cancel_requested", input.phoneStatus ?? null);
  }

  const runStatus = normalize(input.activeRunStatus);
  if (activeRunStatuses.has(runStatus)) {
    return projection("active_ig_run", runStatus, input.phoneStatus ?? null);
  }

  const indicatorState = normalize(input.runtimeIndicatorState);
  if (indicatorState === "active") {
    return projection("runtime_indicator", "runtime_indicator_active", input.phoneStatus ?? null);
  }

  const heartbeatStatus = normalize(input.phoneStatus);
  if (activeHeartbeatStatuses.has(heartbeatStatus)) {
    return projection("heartbeat", heartbeatStatus, input.phoneStatus ?? null);
  }

  return projection("none", "no_active_runtime_signal", input.phoneStatus ?? null);
}
