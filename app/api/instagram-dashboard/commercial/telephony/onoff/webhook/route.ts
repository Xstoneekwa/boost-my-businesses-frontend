import { followupWebhook } from "@/lib/commercial/followup-webhook";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return followupWebhook(request, "onoff");
}
