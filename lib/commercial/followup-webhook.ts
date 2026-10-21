import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestFollowup } from "./followup-service";
import { sameSecret, calendlySignature } from "./followup-providers";
/** Provider principal is explicitly bound to an active commercial owner, never a browser admin. */
export async function followupWebhook(
  request: Request,
  provider: "onoff" | "calendly",
) {
  if (process.env.COMMERCIAL_FOLLOWUP_WEBHOOKS_ENABLED !== "true")
    return Response.json(
      { error: "webhook_disabled_for_certification" },
      { status: 503 },
    );
  const body = await request.text();
  if (body.length > 30000)
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  const valid =
    provider === "onoff"
      ? sameSecret(
          request.headers.get("X-API-KEY"),
          process.env.COMMERCIAL_ONOFF_WEBHOOK_SECRET,
        )
      : calendlySignature(
          body,
          request.headers.get("Calendly-Webhook-Signature"),
          process.env.COMMERCIAL_CALENDLY_WEBHOOK_SECRET,
        );
  if (!valid)
    return Response.json({ error: "unauthorized_webhook" }, { status: 401 });
  const actor = process.env.COMMERCIAL_WEBHOOK_OWNER_USER_ID;
  if (!actor)
    return Response.json({ error: "owner_binding_missing" }, { status: 503 });
  const { data, error } = await createSupabaseAdminClient().rpc(
    "commercial_crm_actor_authorized_v1",
    { p_actor_user_id: actor },
  );
  if (error || data !== true)
    return Response.json({ error: "owner_binding_denied" }, { status: 403 });
  try {
    JSON.parse(body);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    return Response.json({
      ok: true,
      result: await ingestFollowup(
        { provider, payload: JSON.parse(body) },
        actor,
      ),
    });
  } catch {
    return Response.json(
      { error: "webhook_processing_failed" },
      { status: 503 },
    );
  }
}
