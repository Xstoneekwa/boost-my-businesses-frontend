// Pure projection: only enrolled leads and genuine completed review events count.
export type FeedbackEvent = { lead_id: string; event_type: string; occurred_at: string; metadata_safe: Record<string, unknown> };
export type FeedbackItem = { lead_id: string; state: string; channel: string; angle: string; body: string | null; validation_codes: string[]; generation_attempt_count: number; max_generation_attempts: number };
export type FeedbackLead = { id: string; qualification_status: string };
export type FeedbackRate = { count: number; total: number; percent: number | null };
export const HUMAN_REVIEW_CANARY_KEY = "human_review_canary_v1";

export function feedbackRate(count: number, total: number): FeedbackRate {
  return { count, total, percent: total ? count / total * 100 : null };
}

export function reviewPercentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  return sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1);
}

export function buildHumanReviewFeedback(events: FeedbackEvent[], items: FeedbackItem[], leads: FeedbackLead[]) {
  const enrolled = new Map(events.filter((e) => e.event_type === "human_review_canary_enrolled" && e.metadata_safe.canary_key === HUMAN_REVIEW_CANARY_KEY).map((e) => [e.lead_id, e]));
  const completed = [...new Map(events.filter((e) => e.event_type === "human_review_completed" && enrolled.has(e.lead_id)
    && e.metadata_safe.canary_key === HUMAN_REVIEW_CANARY_KEY && ["approved", "rejected"].includes(String(e.metadata_safe.human_decision)))
    .map((e) => [e.lead_id, e])).values()];
  const approved = completed.filter((e) => e.metadata_safe.human_decision === "approved");
  const rejected = completed.filter((e) => e.metadata_safe.human_decision === "rejected");
  const priorityRate = (priority: string) => {
    const group = completed.filter((e) => enrolled.get(e.lead_id)?.metadata_safe.ai_priority === priority);
    return feedbackRate(group.filter((e) => e.metadata_safe.human_decision === "approved").length, group.length);
  };
  const agreement = (original: string, final: string, valid: string[]) => {
    const group = completed.filter((e) => valid.includes(String(enrolled.get(e.lead_id)?.metadata_safe[original])) && valid.includes(String(e.metadata_safe[final])));
    return feedbackRate(group.filter((e) => enrolled.get(e.lead_id)?.metadata_safe[original] === e.metadata_safe[final]).length, group.length);
  };
  const durations = completed.map((e) => e.metadata_safe.review_duration_seconds).filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);
  const reasons = new Map<string, number>();
  rejected.forEach((e) => { const reason = String(e.metadata_safe.reject_reason || "unrecorded"); reasons.set(reason, (reasons.get(reason) ?? 0) + 1); });
  const validPreviews = approved.filter((e) => items.some((i) => i.lead_id === e.lead_id && ["ready_for_review", "queued_dry_run"].includes(i.state)
    && i.channel === e.metadata_safe.human_channel_final && i.angle === e.metadata_safe.human_angle_final && Boolean(i.body?.trim()) && i.validation_codes.length === 0));
  const terminalFailures = approved.filter((e) => items.some((i) => i.lead_id === e.lead_id && i.state === "generation_failed" && i.generation_attempt_count >= i.max_generation_attempts)).length;
  const missingItems = approved.filter((e) => !items.some((i) => i.lead_id === e.lead_id && i.state !== "cancelled")).length;
  const messageApproved = validPreviews.filter((e) => items.some((i) => i.lead_id === e.lead_id && i.state === "queued_dry_run")).length;
  const p1 = priorityRate("urgent"); const p2 = priorityRate("high");
  const pending = enrolled.size - completed.length;
  return {
    cohortSize: enrolled.size, reviewed: completed.length, pending, approved: approved.length, rejected: rejected.length,
    complete: enrolled.size === 25 && p1.total === 15 && p2.total === 10,
    p1, p2, channelAgreement: agreement("ai_channel", "human_channel_final", ["instagram", "email"]),
    angleAgreement: agreement("ai_angle", "human_angle_final", ["A", "B"]),
    approveRate: feedbackRate(approved.length, completed.length), rejectRate: feedbackRate(rejected.length, completed.length),
    editRate: feedbackRate(completed.filter((e) => e.metadata_safe.lead_edited === true).length, completed.length),
    medianSeconds: reviewPercentile(durations, 0.5), p90Seconds: reviewPercentile(durations, 0.9), timedReviews: durations.length,
    scoreBands: [{ label: "9.0–10", min: 90, max: 101 }, { label: "8.5–8.9", min: 85, max: 90 }, { label: "8.0–8.4", min: 80, max: 85 }, { label: "7.5–7.9", min: 75, max: 80 }, { label: "Below 7.5", min: 0, max: 75 }].map((band) => {
      const group = completed.filter((e) => { const score = enrolled.get(e.lead_id)?.metadata_safe.ai_score; return typeof score === "number" && score >= band.min && score < band.max; });
      return { label: band.label, ...feedbackRate(group.filter((e) => e.metadata_safe.human_decision === "approved").length, group.length) };
    }),
    rejectionReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    validPreviews: validPreviews.length, approvedWithoutPreview: approved.length - validPreviews.length, terminalFailures, missingItems,
    inconsistentPending: leads.filter((l) => enrolled.has(l.id) && l.qualification_status !== "qualified" && !completed.some((e) => e.lead_id === l.id)).length,
    funnel: [
      { label: "Discovery", count: enrolled.size }, { label: "Qualified", count: enrolled.size },
      { label: "Needs Approval", count: enrolled.size }, { label: "Approved", count: approved.length },
      { label: "Outreach Preview Ready", count: validPreviews.length }, { label: "Message Approved Dry Run", count: messageApproved },
    ],
    members: [...enrolled.values()].sort((a, b) => Number(a.metadata_safe.position) - Number(b.metadata_safe.position)).map((e) => ({
      id: e.lead_id, aiPriority: String(e.metadata_safe.ai_priority), aiScore: Number(e.metadata_safe.ai_score),
      aiChannel: String(e.metadata_safe.ai_channel), aiAngle: String(e.metadata_safe.ai_angle),
      startedAt: events.find((s) => s.lead_id === e.lead_id && s.event_type === "human_review_started")?.occurred_at ?? null,
      completed: completed.some((c) => c.lead_id === e.lead_id),
    })),
  };
}
export type HumanReviewFeedback = ReturnType<typeof buildHumanReviewFeedback>;
