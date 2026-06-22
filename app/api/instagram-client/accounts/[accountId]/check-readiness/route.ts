import { jsonError, jsonOk, readJsonBody, readString } from "@/app/api/instagram-dashboard/_utils";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { checkClientAccountReadiness } from "@/lib/instagram-client/connect-account";

export const dynamic = "force-dynamic";

type Body = { dry_run?: unknown; mode?: unknown };

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const session = await requireClientInstagramSession();
  if (!session.ok) return jsonError(session.error, session.status);

  const { accountId } = await context.params;
  const normalizedAccountId = readString(accountId);
  if (!normalizedAccountId) return jsonError("Missing account id.", 400);

  const authorized = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
  if (!authorized.ok) return jsonError(authorized.error, authorized.status);

  await readJsonBody<Body>(request);

  const result = await checkClientAccountReadiness({
    accountId: normalizedAccountId,
    userId: session.userId,
    clientId: session.clientId,
  });

  return jsonOk(result);
}
