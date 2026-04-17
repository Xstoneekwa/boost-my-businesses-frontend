import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const n8nUrl =
      process.env.UGC_WEBHOOK_URL ||
      process.env.NEXT_PUBLIC_UGC_WEBHOOK_URL;

    console.log("UGC_WEBHOOK_URL =", process.env.UGC_WEBHOOK_URL);
    console.log(
      "NEXT_PUBLIC_UGC_WEBHOOK_URL =",
      process.env.NEXT_PUBLIC_UGC_WEBHOOK_URL
    );
    console.log("Resolved n8nUrl =", n8nUrl);

    if (!n8nUrl) {
      return NextResponse.json(
        { error: "UGC_WEBHOOK_URL is not set" },
        { status: 500 }
      );
    }

    const response = await fetch(n8nUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const contentType = response.headers.get("content-type") || "";
    const rawText = await response.text();

    console.log("RAW RESPONSE FROM N8N =", rawText);

    return new NextResponse(rawText, {
      status: response.status,
      headers: {
        "Content-Type": contentType || "application/json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to reach n8n webhook",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}