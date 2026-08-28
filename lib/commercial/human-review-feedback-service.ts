import "server-only";
import { cache } from "react";
import { requireCommercialCrmAccess } from "./crm-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildHumanReviewFeedback, type FeedbackEvent, type FeedbackItem, type FeedbackLead } from "./human-review-feedback";

// Per-request only, never shared across users. Every entry point authenticates.
export const getHumanReviewFeedback = cache(async () => {
  await requireCommercialCrmAccess();
  const db = createSupabaseAdminClient();
  const enrollment = await db.from("commercial_events").select("lead_id,event_type,occurred_at,metadata_safe").eq("event_type", "human_review_canary_enrolled").limit(26);
  if (enrollment.error || (enrollment.data?.length ?? 0) > 25) throw new Error("commercial_canary_unavailable");
  const members = (enrollment.data ?? []) as FeedbackEvent[];
  const ids = members.map((e) => e.lead_id);
  if (!ids.length) return buildHumanReviewFeedback([], [], []);
  const [feedback, items, leads] = await Promise.all([
    db.from("commercial_events").select("lead_id,event_type,occurred_at,metadata_safe").in("lead_id", ids).in("event_type", ["human_review_started", "human_review_completed"]).limit(51),
    db.from("commercial_outreach_items").select("lead_id,state,channel,angle,body,validation_codes,generation_attempt_count,max_generation_attempts").in("lead_id", ids).neq("state", "cancelled").limit(26),
    db.from("commercial_leads").select("id,qualification_status").in("id", ids).limit(25),
  ]);
  if (feedback.error || items.error || leads.error || (feedback.data?.length ?? 0) > 50 || (items.data?.length ?? 0) > 25 || leads.data?.length !== ids.length) throw new Error("commercial_canary_unavailable");
  return buildHumanReviewFeedback([...members, ...(feedback.data ?? []) as FeedbackEvent[]], (items.data ?? []) as FeedbackItem[], (leads.data ?? []) as FeedbackLead[]);
});

export async function startHumanReview(leadId: string) {
  const actor = await requireCommercialCrmAccess();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)) throw new Error("commercial_lead_invalid");
  const { data, error } = await createSupabaseAdminClient().rpc("start_commercial_human_review_v1", { p_actor_user_id: actor.userId, p_lead_id: leadId });
  if (error) throw new Error("commercial_review_start_failed");
  return data as { ok: true; lead_id: string; review_started_at: string };
}
