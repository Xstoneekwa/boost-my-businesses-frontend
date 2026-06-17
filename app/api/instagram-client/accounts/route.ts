import { jsonError, jsonOk, readJsonBody } from "@/app/api/instagram-dashboard/_utils";
import { createClientInstagramAccount } from "@/lib/instagram-client/create-account";
import {
  readBoolean,
  readString,
  rejectTechnicalClientFields,
  requireClientInstagramSession,
} from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

type CreateBody = {
  username?: unknown;
  password?: unknown;
  email?: unknown;
  notes?: unknown;
  dry_run?: unknown;
};

export async function POST(request: Request) {
  const session = await requireClientInstagramSession();
  if (!session.ok) return jsonError(session.error, session.status);

  const body = await readJsonBody<CreateBody>(request);
  const technicalError = rejectTechnicalClientFields(body as Record<string, unknown>);
  if (technicalError) return jsonError(technicalError, 400, { code: "technical_fields_forbidden" });

  const result = await createClientInstagramAccount({
    clientId: session.clientId,
    userId: session.userId,
    username: readString(body?.username),
    password: readString(body?.password),
    email: readString(body?.email),
    notes: readString(body?.notes),
    dryRun: readBoolean(body?.dry_run, false),
  });

  if (!result.ok) return jsonError(result.error, result.status, { code: result.code });
  return jsonOk({
    account: result.account,
    assignment: result.assignment,
    dry_run: result.dryRun === true,
  });
}
