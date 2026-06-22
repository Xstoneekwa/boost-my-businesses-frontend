import { NextResponse } from "next/server";
import {
  clientConnectErrorBody,
  clientConnectHttpStatus,
  clientConnectOkBody,
  type ClientConnectStatus,
} from "@/lib/instagram-client/connect-client-contract";

export function clientConnectOk(
  data: Record<string, unknown> & { connectStatus: ClientConnectStatus; message: string },
) {
  return NextResponse.json(clientConnectOkBody(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function clientConnectError(input: {
  status: ClientConnectStatus;
  code: string;
  message: string;
  httpStatus?: number;
  reason?: string;
  client_readiness_status?: string;
  data?: Record<string, unknown>;
}) {
  return NextResponse.json(clientConnectErrorBody(input), {
    status: clientConnectHttpStatus(input),
    headers: { "Content-Type": "application/json" },
  });
}
