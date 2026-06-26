import {
  addAccountTargetSingle,
  addAccountTargetsBulk,
  archiveAccountTargets,
  listAdminAccountTargets,
  restoreAccountTarget,
  type TargetsServiceContext,
} from "@/lib/instagram-dashboard/targets-service";
import type { TargetActorType } from "@/lib/instagram-targets";
import {
  getAccountId,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireInstagramAdmin,
} from "../_utils";
import { compassRelayAuthFailureReason, relayAuthStatus, verifyCompassRelayKey } from "../compass/relay-auth";

export const dynamic = "force-dynamic";

export { safeTargetRow } from "@/lib/instagram-dashboard/targets-service";

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return jsonError("Targets relay authentication failed.", relayAuthStatus(compassRelayAuthFailureReason(relayAuth)), { reason: compassRelayAuthFailureReason(relayAuth) });
  }
  return requireInstagramAdmin();
}

function serviceContext(actorType: TargetActorType): TargetsServiceContext {
  return {
    actorType,
    sourceSurface: "admin_dashboard",
  };
}

export async function GET(request: Request) {
  try {
    const unauthorized = await requireRelayOrAdmin(request);
    if (unauthorized) return unauthorized;

    const accountId = getAccountId(request);
    if (!accountId) return jsonError("Missing account_id.", 400);

    const result = await listAdminAccountTargets(accountId);
    if (!result.ok) return jsonError(result.error, result.status);
    return jsonOk(result.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load targets.";
    return jsonError(message, 500);
  }
}

type PostBody = {
  account_id?: string;
  target_username?: string;
  usernames?: string[];
  followers_count?: number | string | null;
  actor_type?: TargetActorType;
};

export async function POST(request: Request) {
  try {
    const unauthorized = await requireRelayOrAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<PostBody>(request);
    if (!body) return jsonError("Invalid JSON body.", 400);

    const accountId = readString(body.account_id, "").trim();
    if (!accountId) return jsonError("Missing account_id.", 400);
    const actorType: TargetActorType = body.actor_type === "client" ? "client" : "admin";
    const ctx = serviceContext(actorType);

    if (Array.isArray(body.usernames)) {
      const result = await addAccountTargetsBulk(accountId, body.usernames, ctx);
      if (!result.ok) return jsonError(result.error, result.status);
      return jsonOk(result.data);
    }

    const result = await addAccountTargetSingle(
      accountId,
      readString(body.target_username, ""),
      ctx,
      body.followers_count,
    );
    if (!result.ok) return jsonError(result.error, result.status);
    return jsonOk(result.data, result.status ?? 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create targets.";
    return jsonError(message, 500);
  }
}

type DeleteBody = {
  account_id?: string;
  ids?: string[];
  actor_type?: TargetActorType;
};

export async function DELETE(request: Request) {
  try {
    const unauthorized = await requireRelayOrAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<DeleteBody>(request);
    if (!body) return jsonError("Invalid JSON body.", 400);

    const accountId = readString(body.account_id, "").trim();
    if (!accountId) return jsonError("Missing account_id.", 400);
    const actorType: TargetActorType = body.actor_type === "client" ? "client" : "admin";
    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => readString(id, "").trim()).filter(Boolean)
      : [];

    const result = await archiveAccountTargets(accountId, ids, serviceContext(actorType));
    if (!result.ok) return jsonError(result.error, result.status);
    return jsonOk(result.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to archive targets.";
    return jsonError(message, 500);
  }
}

type PatchBody = {
  account_id?: string;
  id?: string;
  ids?: string[];
  action?: "restore" | "unarchive";
  actor_type?: TargetActorType;
};

export async function PATCH(request: Request) {
  try {
    const unauthorized = await requireRelayOrAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<PatchBody>(request);
    if (!body) return jsonError("Invalid JSON body.", 400);

    const accountId = readString(body.account_id, "").trim();
    if (!accountId) return jsonError("Missing account_id.", 400);
    const action = readString(body.action, "").toLowerCase();
    if (action !== "restore" && action !== "unarchive") return jsonError("Unsupported target lifecycle action.", 400);
    const actorType: TargetActorType = body.actor_type === "client" ? "client" : "admin";

    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => readString(id, "").trim()).filter(Boolean)
      : [readString(body.id, "").trim()].filter(Boolean);
    if (ids.length !== 1) return jsonError("Restore expects exactly one target id.", 400);

    const result = await restoreAccountTarget(accountId, ids[0], serviceContext(actorType));
    if (!result.ok) return jsonError(result.error, result.status);
    return jsonOk(result.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to restore target.";
    return jsonError(message, 500);
  }
}
