import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, requireInstagramAdmin, type SupabaseRecord } from "../_utils";

export const dynamic = "force-dynamic";

const localDevice = {
  id: "local-android-emulator",
  device_name: "Local Android Emulator",
  device_udid: "emulator-5554",
  platform: "android",
  status: "available",
  appium_port: null,
  notes: "Local fallback device for setup.",
};

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
    return jsonOk(devices.length ? devices : [localDevice]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load devices.";
    return jsonError(message, 500);
  }
}
