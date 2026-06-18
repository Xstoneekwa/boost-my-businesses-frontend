import { clientTargetAvatarProxyPath } from "@/lib/instagram-dashboard/target-avatar-projection";
import { clientAiCandidateAvatarProxyPath } from "@/lib/instagram-client/target-ai-candidate-avatar";

export function clientTargetAvatarImagePath(
  accountId: string,
  input: { targetId?: string | null; username?: string | null; avatarAvailable?: boolean },
) {
  if (input.avatarAvailable === false) return null;
  if (input.targetId) return clientTargetAvatarProxyPath(accountId, input.targetId);
  const username = input.username?.trim().replace(/^@+/, "").toLowerCase();
  if (username) return clientAiCandidateAvatarProxyPath(accountId, username);
  return null;
}
