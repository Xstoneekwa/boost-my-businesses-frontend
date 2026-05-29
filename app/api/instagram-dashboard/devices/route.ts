import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, requireInstagramAdmin, type SupabaseRecord } from "../_utils";

export const dynamic = "force-dynamic";

const localDevice = {
  id: "local-android-emulator",
  device_name: "Local Android Emulator",
  platform: "android",
  status: "available",
  notes: "Local fallback device for setup.",
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function safeDevice(row: SupabaseRecord) {
  return {
    id: readString(row.id, ""),
    device_name: readString(row.device_name, readString(row.name, "Unknown phone")),
    phone_name: readString(row.phone_name, readString(row.device_name, "Unknown phone")),
    host_name: readString(row.host_name, readString(row.mac_host_name, "Local Mac")),
    platform: readString(row.platform, "android"),
    status: readString(row.status, "unknown"),
    notes: readString(row.notes, ""),
  };
}

export async function GET() {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("ig_devices")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      return jsonOk([localDevice]);
    }

    const devices = (data ?? []) as SupabaseRecord[];
    return jsonOk(devices.length ? devices.map(safeDevice) : [localDevice]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load devices.";
    return jsonError(message, 500);
  }
}
