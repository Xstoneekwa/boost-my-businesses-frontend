type CanonicalNotificationInput = {
  title: string;
  incidentId: string;
  actionId?: string | null;
  accountId?: string | null;
  accountUsername: string;
  reason: string;
  state: string;
  severity?: string | null;
  runId?: string | null;
  requestId?: string | null;
  operatorId?: string | null;
};

const CANONICAL_INCIDENTS_URL = "https://www.boostmybusinesses.com/instagram-dashboard/incidents";
export const INCIDENT_ACTION_CTA_LABEL = "Open Incidents/Actions";

function shortId(value?: string | null) {
  return value ? `${value.slice(0, 8)}...` : null;
}

export function canonicalIncidentActionUrl(input: Pick<CanonicalNotificationInput, "incidentId" | "actionId">) {
  const url = new URL(CANONICAL_INCIDENTS_URL);
  if (input.incidentId) url.searchParams.set("incident_id", input.incidentId);
  if (input.actionId) url.searchParams.set("action_id", input.actionId);
  return url.toString();
}

export function buildCanonicalIncidentNotification(input: CanonicalNotificationInput) {
  const accountId = shortId(input.accountId);
  const lines = [
    input.title,
    `Account: @${input.accountUsername || "unknown"}${accountId ? ` (${accountId})` : ""}`,
    `Reason: ${input.reason || "Review the incident details."}`,
    `State: ${input.state || "open"}`,
  ];
  if (input.severity) lines.push(`Severity: ${input.severity}`);
  if (input.runId) lines.push(`Run: ${shortId(input.runId)}`);
  if (input.requestId) lines.push(`Request: ${shortId(input.requestId)}`);
  if (input.operatorId) lines.push(`Operator: ${input.operatorId}`);
  if (input.actionId) lines.push(`Action: ${shortId(input.actionId)}`);

  const text = lines.join("\n");
  const actionUrl = canonicalIncidentActionUrl(input);
  return {
    text,
    actionUrl,
    slackBody: {
      text: `${text}\n<${actionUrl}|${INCIDENT_ACTION_CTA_LABEL}>`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text } },
        { type: "section", text: { type: "mrkdwn", text: `<${actionUrl}|${INCIDENT_ACTION_CTA_LABEL}>` } },
      ],
    },
    discordBody: {
      content: `${text}\n[${INCIDENT_ACTION_CTA_LABEL}](${actionUrl})`,
    },
  } as const;
}
