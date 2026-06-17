import { NextResponse } from "next/server";
import { projectTargetSafeRowAvatar, projectTargetSafeRowsAvatar } from "@/lib/instagram-dashboard/target-avatar-projection";
import {
  addAccountTargetSingle,
  addAccountTargetsBulk,
  archiveAccountTargets,
  listAccountTargets,
  restoreAccountTarget,
} from "@/lib/instagram-dashboard/targets-service";
import { authorizeClientInstagramAccount, readString, rejectTechnicalClientFields, requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

const clientTargetsContext = {
  actorType: "client" as const,
  sourceSurface: "client_dashboard" as const,
};

async function authorizeAccountRoute(accountId: string) {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return { error: NextResponse.json({ ok: false, error: session.error }, { status: session.status }) };
  }
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) {
    return { error: NextResponse.json({ ok: false, error: "Missing account id." }, { status: 400 }) };
  }
  const ownership = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
  if (!ownership.ok) {
    return { error: NextResponse.json({ ok: false, error: ownership.error }, { status: ownership.status }) };
  }
  return { accountId: normalizedAccountId };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAccountRoute(accountId ?? "");
  if ("error" in auth) return auth.error;

  const result = await listAccountTargets(auth.accountId);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, data: projectTargetSafeRowsAvatar(result.data) });
}

type PostBody = {
  target_username?: string;
  usernames?: string[];
};

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAccountRoute(accountId ?? "");
  if ("error" in auth) return auth.error;

  let body: PostBody | null = null;
  try {
    body = await request.json() as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const technicalError = rejectTechnicalClientFields(body ?? {});
  if (technicalError) return NextResponse.json({ ok: false, error: technicalError }, { status: 400 });

  if (Array.isArray(body?.usernames)) {
    const result = await addAccountTargetsBulk(auth.accountId, body.usernames, clientTargetsContext);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, data: result.data });
  }

  const result = await addAccountTargetSingle(
    auth.accountId,
    readString(body?.target_username, ""),
    clientTargetsContext,
  );
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({
    ok: true,
    data: {
      ...result.data,
      row: projectTargetSafeRowAvatar(result.data.row),
    },
  }, { status: result.status ?? 201 });
}

type DeleteBody = { ids?: string[] };

export async function DELETE(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAccountRoute(accountId ?? "");
  if ("error" in auth) return auth.error;

  let body: DeleteBody | null = null;
  try {
    body = await request.json() as DeleteBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const technicalError = rejectTechnicalClientFields(body ?? {});
  if (technicalError) return NextResponse.json({ ok: false, error: technicalError }, { status: 400 });

  const ids = Array.isArray(body?.ids)
    ? body.ids.map((id) => readString(id, "").trim()).filter(Boolean)
    : [];

  const result = await archiveAccountTargets(auth.accountId, ids, clientTargetsContext);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, data: result.data });
}

type PatchBody = {
  id?: string;
  action?: "restore" | "unarchive";
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAccountRoute(accountId ?? "");
  if ("error" in auth) return auth.error;

  let body: PatchBody | null = null;
  try {
    body = await request.json() as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const technicalError = rejectTechnicalClientFields(body ?? {});
  if (technicalError) return NextResponse.json({ ok: false, error: technicalError }, { status: 400 });

  const action = readString(body?.action, "").toLowerCase();
  if (action !== "restore" && action !== "unarchive") {
    return NextResponse.json({ ok: false, error: "Unsupported target lifecycle action." }, { status: 400 });
  }
  const targetId = readString(body?.id, "").trim();
  if (!targetId) return NextResponse.json({ ok: false, error: "Missing target id." }, { status: 400 });

  const result = await restoreAccountTarget(auth.accountId, targetId, clientTargetsContext);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, data: result.data });
}
