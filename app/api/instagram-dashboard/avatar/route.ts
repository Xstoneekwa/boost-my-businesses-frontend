import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, readString, requireInstagramAdmin, type SupabaseRecord } from "../_utils";

export const dynamic = "force-dynamic";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

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

async function readAvatarUrl(kind: string, id: string) {
  const supabase = createSupabaseClient();
  if (kind === "account") {
    const { data, error } = await supabase
      .from("ig_accounts")
      .select("avatar_url")
      .eq("id", id)
      .maybeSingle<SupabaseRecord>();
    if (error) return null;
    return safeAvatarUrl(readString(data?.avatar_url, ""));
  }

  if (kind === "target") {
    const { data, error } = await supabase
      .from("ig_targets")
      .select("avatar_url")
      .eq("id", id)
      .maybeSingle<SupabaseRecord>();
    if (error) return null;
    return safeAvatarUrl(readString(data?.avatar_url, ""));
  }

  return null;
}

export async function GET(request: Request) {
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return unauthorizedResponse;

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind")?.trim() ?? "";
  const id = url.searchParams.get("id")?.trim() ?? "";
  if (!id || !["account", "target"].includes(kind)) return jsonError("avatar_not_found", 404);

  const avatarUrl = await readAvatarUrl(kind, id);
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
