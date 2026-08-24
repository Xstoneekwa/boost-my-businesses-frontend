import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  resolveTargetAvatarUpstream,
  type TargetAvatarProxyEvent,
} from "@/lib/instagram-client/target-avatar-proxy-server";
import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, readString, requireInstagramAdmin, type SupabaseRecord } from "../_utils";
import { verifyCompassRelayKey } from "../compass/relay-auth";

export const dynamic = "force-dynamic";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TARGET_AVATAR_NEGATIVE_CACHE_TTL_MS = 60_000;

function safeAvatarUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const unsafeText = `${url.search} ${url.hash}`.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (["token", "secret", "authorization", "service_role", "supabase_vault://"].some((term) => unsafeText.includes(term))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function readAccountAvatarUrl(id: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_accounts")
    .select("avatar_url")
    .eq("id", id)
    .maybeSingle<SupabaseRecord>();
  if (error) return null;
  return safeAvatarUrl(readString(data?.avatar_url, ""));
}

async function readTargetAvatarSource(id: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_targets")
    .select("avatar_url,normalized_username,target_username")
    .eq("id", id)
    .maybeSingle<SupabaseRecord>();
  if (error || !data) return null;
  const username = readString(data.normalized_username, readString(data.target_username, ""));
  if (!username) return null;
  return {
    username,
    storedAvatarUrl: safeAvatarUrl(readString(data.avatar_url, "")),
  };
}

function targetIdHash(id: string) {
  return createHash("sha256").update(id).digest("hex").slice(0, 12);
}

function logTargetAvatarResolution(id: string, events: TargetAvatarProxyEvent[], fallbackUsed: boolean) {
  const upstream = events.filter((event) => event.type === "upstream_fetch").at(-1);
  const refresh = events.filter((event) => event.type === "provider_refresh").at(-1);
  console.info("[Instagram dashboard avatar] target resolution", {
    kind: "target",
    target_id_hash: targetIdHash(id),
    upstream_hostname: upstream?.type === "upstream_fetch" ? upstream.hostname : null,
    upstream_status: upstream?.type === "upstream_fetch" ? upstream.status : null,
    refresh_attempted: Boolean(refresh),
    refresh_result: refresh?.type === "provider_refresh" ? refresh.result : "not_attempted",
    fallback_used: fallbackUsed,
    negative_cache_hit: events.some((event) => event.type === "negative_cache" && event.result === "hit"),
  });
}

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return jsonError("Avatar relay authentication failed.", 403, { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function GET(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request);
  if (unauthorizedResponse) return unauthorizedResponse;

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind")?.trim() ?? "";
  const id = url.searchParams.get("id")?.trim() ?? "";
  if (!id || !["account", "target"].includes(kind)) return jsonError("avatar_not_found", 404);

  if (kind === "target") {
    const source = await readTargetAvatarSource(id);
    if (!source) return jsonError("avatar_not_found", 404);
    const events: TargetAvatarProxyEvent[] = [];
    const upstream = await resolveTargetAvatarUpstream({
      username: source.username,
      storedAvatarUrl: source.storedAvatarUrl,
      negativeCacheTtlMs: TARGET_AVATAR_NEGATIVE_CACHE_TTL_MS,
    }, {
      onEvent: (event) => events.push(event),
    });
    if (!upstream?.body) {
      logTargetAvatarResolution(id, events, true);
      return new NextResponse(null, {
        status: 404,
        headers: { "Cache-Control": "private, max-age=60" },
      });
    }
    logTargetAvatarResolution(id, events, false);
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.contentType,
        "Cache-Control": "private, max-age=900",
      },
    });
  }

  const avatarUrl = await readAccountAvatarUrl(id);
  if (!avatarUrl) return jsonError("avatar_not_found", 404);

  try {
    const upstream = await fetch(avatarUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
    });
    if (!upstream.ok) return jsonError("avatar_unavailable", 502);

    const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!allowedImageTypes.has(contentType)) return jsonError("avatar_unavailable", 502);

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=900",
      },
    });
  } catch {
    return jsonError("avatar_unavailable", 502);
  }
}
