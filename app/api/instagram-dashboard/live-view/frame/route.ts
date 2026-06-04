import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import {
  canServeLiveViewFrame,
  isLiveViewFrameSessionId,
  liveViewFrameObjectPath,
  liveViewFrameStorageBucket,
} from "../../../../instagram-dashboard/live-view-frame-data";
import {
  getAccountId,
  jsonError,
  readString,
  requireInstagramAdmin,
  type SupabaseRecord,
} from "../../_utils";

export const dynamic = "force-dynamic";

function localFramePath(frameDir: string, sessionId: string) {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${frameDir.replace(/\/+$/, "")}/${safeId}.png`;
}

async function readLocalFrame(sessionId: string) {
  if (process.env.NODE_ENV === "production") return null;
  const frameDir = process.env.LIVE_VIEW_FRAME_DIR?.trim();
  if (!frameDir) return null;
  try {
    const bytes = await readFile(localFramePath(frameDir, sessionId));
    return bytes.length > 0 && bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      ? bytes
      : null;
  } catch {
    return null;
  }
}

async function readStorageFrame(sessionId: string) {
  const supabase = createSupabaseClient();
  const bucket = liveViewFrameStorageBucket();
  const objectPath = liveViewFrameObjectPath(sessionId);
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (!bytes.length || !bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    return null;
  }
  return bytes;
}

async function loadSession(sessionId: string, accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("live_view_sessions")
    .select("id,account_id,status,stream_transport")
    .eq("id", sessionId)
    .eq("account_id", accountId)
    .maybeSingle<SupabaseRecord>();
  if (error || !data) return null;
  return data;
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const url = new URL(request.url);
    const accountId = getAccountId(request) || readString(url.searchParams.get("account_id"), "").trim();
    const sessionId = readString(url.searchParams.get("live_view_session_id"), "").trim();

    if (!accountId) return jsonError("Missing account_id.", 400);
    if (!isLiveViewFrameSessionId(sessionId)) {
      return jsonError("Missing or invalid live_view_session_id.", 400);
    }

    const session = await loadSession(sessionId, accountId);
    if (!session) return jsonError("Live view session not found.", 404);

    const status = readString(session.status, "");
    const streamTransport = readString(session.stream_transport, "");
    if (!canServeLiveViewFrame({ status, streamTransport })) {
      return jsonError("Live view frame is not available for this session.", 409);
    }

    const frame = (await readStorageFrame(sessionId)) ?? (await readLocalFrame(sessionId));
    if (!frame) {
      return new NextResponse(null, {
        status: status === "active" ? 502 : 204,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }

    return new NextResponse(frame, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch {
    return jsonError("Could not load live view frame.", 500);
  }
}
