import { NextResponse } from "next/server";
import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireRelayOrAdmin,
} from "../_utils";
import { createSupabaseClient } from "@/lib/supabase";
import {
  loadClientEmailTemplatesProjection,
  previewClientEmailTemplate,
  rejectForbiddenEmailTemplateFields,
  saveClientEmailTemplateVersion,
} from "@/lib/instagram-dashboard/client-email-templates";
import { CLIENT_EMAIL_TEMPLATE_CATEGORIES } from "@/lib/instagram-dashboard/client-email-constants";

export const dynamic = "force-dynamic";

type TemplatePostBody = {
  action?: unknown;
  category?: unknown;
  subject?: unknown;
  body_text?: unknown;
  bodyText?: unknown;
};

function readUpdatedBy(request: Request) {
  return request.headers.get("x-external-user-id")?.trim()
    || "botapp_relay";
}

export async function GET(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Email templates");
  if (unauthorizedResponse) return unauthorizedResponse;

  try {
    const supabase = createSupabaseClient();
    const projection = await loadClientEmailTemplatesProjection(supabase);
    return jsonOk(projection);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load email templates.";
    return jsonError(message, 500);
  }
}

export async function POST(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Email templates");
  if (unauthorizedResponse) return unauthorizedResponse;

  const body = (await readJsonBody<TemplatePostBody>(request)) ?? {};
  const forbidden = rejectForbiddenEmailTemplateFields(body as Record<string, unknown>);
  if (forbidden) return jsonError(forbidden, 400);

  const action = readString(body.action, "save").trim().toLowerCase();
  const subject = readString(body.subject, "").trim();
  const bodyText = readString(body.body_text ?? body.bodyText, "").trim();
  const category = readString(body.category, "").trim();

  if (action === "preview") {
    const preview = previewClientEmailTemplate({ subject, bodyText });
    if (!preview.ok) {
      return jsonError("Unknown template variables are not allowed.", 400, {
        unknown_variables: preview.unknownVariables,
      });
    }
    return jsonOk(preview);
  }

  if (!CLIENT_EMAIL_TEMPLATE_CATEGORIES.includes(category as typeof CLIENT_EMAIL_TEMPLATE_CATEGORIES[number])) {
    return jsonError("Unsupported email template category.", 400);
  }

  try {
    const supabase = createSupabaseClient();
    const userContext = await getInstagramAdminUserContext();
    const updatedBy = request.headers.get("x-external-user-id")?.trim()
      || userContext?.userId
      || readUpdatedBy(request);

    const result = await saveClientEmailTemplateVersion(supabase, {
      category: category as typeof CLIENT_EMAIL_TEMPLATE_CATEGORIES[number],
      subject,
      bodyText,
      updatedBy,
    });

    if (!result.ok) {
      if (result.reason === "feature_unavailable") {
        return NextResponse.json({
          ok: false,
          featureAvailable: false,
          reason: "feature_unavailable",
          error: "Email infrastructure is not enabled yet.",
        }, { status: 503 });
      }
      if (result.reason === "unknown_variables") {
        return jsonError("Unknown template variables are not allowed.", 400, {
          unknown_variables: result.unknownVariables ?? [],
        });
      }
      return jsonError(`Invalid template ${result.reason.replace(/_/g, " ")}.`, 400);
    }

    return jsonOk({
      featureAvailable: true,
      template: result.template,
      created_new_version: result.createdNewVersion,
      log_event: result.createdNewVersion ? "client_email_template_version_created" : "client_email_template_unchanged",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save email template.";
    return jsonError(message, 500);
  }
}
