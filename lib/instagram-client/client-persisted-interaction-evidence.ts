import { verifiedUnfollowRowsAsInteractionEvents } from "../instagram-dashboard/social-counters.ts";
import { resolveClientCampaignInteractionRule } from "./client-campaign-interaction-types.ts";
import { readString } from "./guards.ts";

type SafeRecord = Record<string, unknown>;

function verifiedDmJobsAsInteractionEvents(rows: SafeRecord[]) {
  return rows.flatMap((row) => {
    const id = readString(row.id, "");
    const accountId = readString(row.account_id, "");
    const sentAt = readString(row.sent_at, "");
    const status = readString(row.status, "").toLowerCase();
    const dmType = readString(row.dm_type, "").toLowerCase();
    if (!id || !accountId || !sentAt || status !== "sent") return [];
    if (dmType !== "welcome" && dmType !== "outreach") return [];
    return [{
      id: `dm-job:${id}`,
      account_id: accountId,
      username: readString(row.recipient_username, ""),
      event_type: dmType === "outreach" ? "outreach_dm_sent" : "welcome_dm_sent",
      event_status: "success",
      interaction_type: dmType === "outreach" ? "outreach_dm" : "welcome_dm",
      event_at: sentAt,
      created_at: sentAt,
      evidence_source: "ig_dm_jobs.sent_at",
    }];
  });
}

function ruleKind(row: SafeRecord) {
  return resolveClientCampaignInteractionRule({
    eventType: row.event_type,
    interactionType: row.interaction_type,
  })?.actionType ?? null;
}

export function buildClientPersistedInteractionEvidence(input: {
  interactionEvents: SafeRecord[];
  unfollowRows: SafeRecord[];
  dmJobs: SafeRecord[];
}) {
  const unfollows = verifiedUnfollowRowsAsInteractionEvents(input.unfollowRows);
  const dms = verifiedDmJobsAsInteractionEvents(input.dmJobs);
  const canonicalKinds = new Set<string>([
    "unfollow_sent",
    "welcome_dm_sent",
    "outreach_dm_sent",
  ]);

  const events = input.interactionEvents.filter((row) => {
    const kind = ruleKind(row);
    return !kind || !canonicalKinds.has(kind);
  });

  return [...events, ...unfollows, ...dms];
}
