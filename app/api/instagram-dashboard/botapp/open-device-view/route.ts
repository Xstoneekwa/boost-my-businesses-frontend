import { jsonError, jsonOk, readJsonBody, readString } from "../../_utils";
import { compassRelayAuthFailureReason, relayAuthStatus, verifyCompassRelayKey } from "../../compass/relay-auth";
import { loadAssignedDeviceForAccount } from "@/lib/instagram-client/load-assigned-device-for-account";
import { verifyOpenDeviceViewIntent } from "@/lib/instagram-client/open-botapp-phone-intent";

export const dynamic = "force-dynamic";

type Body = {
  intent_token?: unknown;
};

export async function POST(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (!relayAuth.ok || relayAuth.mode !== "relay_key") {
    return jsonError("BotApp relay authentication failed.", relayAuthStatus(compassRelayAuthFailureReason(relayAuth)), { reason: compassRelayAuthFailureReason(relayAuth) });
  }

  const payload = (await readJsonBody<Body>(request)) ?? {};
  const intentToken = readString(payload.intent_token);
  if (!intentToken) return jsonError("Missing open device intent.", 400);

  const verified = verifyOpenDeviceViewIntent(intentToken);
  if (!verified.ok) {
    return jsonError("Open device intent is invalid or expired.", 409, { reason: verified.reason });
  }

  const accountId = readString(verified.payload.account_id);
  const assigned = await loadAssignedDeviceForAccount(accountId);
  if (!assigned) {
    return jsonError("Assigned phone is unavailable for this account.", 409, { reason: "assigned_device_missing" });
  }

  return jsonOk({
    action: "open_device_view",
    account_id: accountId,
    assignment_id: assigned.assignmentId,
    device_serial: assigned.adbSerial,
    device_label: assigned.deviceLabel,
    focus_only: true,
    allow_device_selection: false,
    allow_run_start: false,
    allow_assignment: false,
    source: "client_connect_verification",
  });
}
