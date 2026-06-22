import { readJsonBody, readString } from "@/app/api/instagram-dashboard/_utils";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { connectClientInstagramAccount } from "@/lib/instagram-client/connect-account";
import {
  clientConnectError,
  clientConnectOk,
} from "./connect-response";
import { clientConnectMessage } from "@/lib/instagram-client/connect-client-contract";

export const dynamic = "force-dynamic";

type Body = { dry_run?: unknown; mode?: unknown };

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    const session = await requireClientInstagramSession();
    if (!session.ok) {
      return clientConnectError({
        status: "blocked",
        code: session.status === 401 ? "authentication_required" : "forbidden",
        message: session.error,
        httpStatus: session.status,
      });
    }

    const { accountId } = await context.params;
    const normalizedAccountId = readString(accountId);
    if (!normalizedAccountId) {
      return clientConnectError({
        status: "not_created",
        code: "missing_account_id",
        message: "Missing account id.",
        httpStatus: 400,
      });
    }

    const authorized = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
    if (!authorized.ok) {
      return clientConnectError({
        status: "blocked",
        code: "forbidden",
        message: authorized.error,
        httpStatus: authorized.status,
      });
    }

    await readJsonBody<Body>(request);

    const result = await connectClientInstagramAccount({
      accountId: normalizedAccountId,
      userId: session.userId,
      clientId: session.clientId,
    });

    if (result.passive_blocked) {
      return clientConnectError({
        status: "blocked",
        code: "connect_readiness_not_satisfied",
        message: result.message,
        httpStatus: 409,
        reason: result.reason,
        client_readiness_status: result.client_readiness_status,
        data: { account: result.account },
      });
    }

    if (result.connectStatus === "not_created" || result.connectStatus === "failed") {
      return clientConnectError({
        status: result.connectStatus,
        code: result.connectStatus === "not_created" ? "connect_request_rejected" : "connect_failed",
        message: result.message || clientConnectMessage(result.connectStatus, "fr"),
        httpStatus: result.connectStatus === "not_created" ? 409 : 500,
        reason: result.reason,
        data: { account: result.account },
      });
    }

    return clientConnectOk({
      ...result,
      connectStatus: result.connectStatus,
      message: result.message,
      account: result.account,
    });
  } catch {
    return clientConnectError({
      status: "failed",
      code: "connect_server_error",
      message: clientConnectMessage("failed", "fr"),
      httpStatus: 500,
    });
  }
}
