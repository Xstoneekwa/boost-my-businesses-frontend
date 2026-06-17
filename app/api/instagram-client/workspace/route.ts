import { NextResponse } from "next/server";
import { getClientWorkspaceView, updateClientWorkspaceView } from "@/lib/instagram-client/workspace-data";
import { readString, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { createSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function loadLoginEmail(userId: string) {
  try {
    const supabase = createSupabaseClient();
    const { data } = await supabase.auth.admin.getUserById(userId);
    return readString(data.user?.email, "");
  } catch {
    return "";
  }
}

export async function GET() {
  const session = await requireClientInstagramSession();
  if (!session.ok) return NextResponse.json({ ok: false, error: session.error }, { status: session.status });

  const loginEmail = await loadLoginEmail(session.userId);
  const workspace = await getClientWorkspaceView(session.clientId, loginEmail);
  if (!workspace) return NextResponse.json({ ok: false, error: "Client workspace not found." }, { status: 404 });
  return NextResponse.json({ ok: true, data: workspace });
}

export async function PATCH(request: Request) {
  const session = await requireClientInstagramSession();
  if (!session.ok) return NextResponse.json({ ok: false, error: session.error }, { status: session.status });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.contact_email !== undefined) {
    return NextResponse.json({ ok: false, error: "Login email cannot be changed from the client dashboard." }, { status: 400 });
  }

  const loginEmail = await loadLoginEmail(session.userId);
  const result = await updateClientWorkspaceView(session.clientId, {
    firstName: body.first_name !== undefined ? readString(body.first_name) : undefined,
    lastName: body.last_name !== undefined ? readString(body.last_name) : undefined,
    phone: body.phone !== undefined ? readString(body.phone) : undefined,
    servicePageUrl: body.service_page_url !== undefined ? readString(body.service_page_url) : undefined,
    preferredLanguage: body.preferred_language !== undefined ? readString(body.preferred_language) : undefined,
  }, loginEmail);

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, data: result.workspace });
}
