import { NextResponse } from "next/server";

export async function POST() {
  const suffix = crypto.randomUUID().slice(0, 8);

  return NextResponse.json({
    success: true,
    mode: "mock",
    provider: "none",
    callId: `call_${suffix}`,
    status: "started",
    summary: null,
    message: "Mock voice test started.",
  });
}
