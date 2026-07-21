import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { loadClientInstagramAccounts } from "@/lib/instagram-client/load-client-instagram-accounts";
import { requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireClientInstagramSession();
  if (!session.ok) return jsonError(session.error, session.status);

  const accounts = await loadClientInstagramAccounts(session.clientId);
  return jsonOk({ accounts });
}

export async function POST() {
  const session = await requireClientInstagramSession();
  if (!session.ok) return jsonError(session.error, session.status);
  return jsonError("Use the Instagram onboarding flow to add an account.", 409, {
    code: "instagram_onboarding_required",
  });
}
