import { createSupabaseClient } from "@/lib/supabase";
import { buildDmProjection } from "@/lib/instagram-dashboard/dm-domain-service";
import { loadCanonicalIgAccountUsername } from "@/lib/instagram-client/client-account-canonical";
import { resolveAccountPackageCode } from "@/lib/instagram-client/resolve-account-package-code";
import { readString } from "./guards";
import {
  projectClientDmTemplates,
  type ClientDmTemplatesProjection,
} from "./client-dm-templates-projection";

export type { ClientDmTemplatesProjection, ClientDmTemplateCardProjection } from "./client-dm-templates-projection";
export {
  assertClientCanConfigureOutreach,
  assertClientCanConfigureWelcome,
  buildOutreachActivationPath,
  buildWelcomeUpgradePath,
  DM_USERNAME_VARIABLE,
  projectClientDmTemplates,
  resolveOutreachActivationOffer,
} from "./client-dm-templates-projection";

export async function loadClientDmTemplatesProjection(
  accountId: string,
  usernameHint = "",
): Promise<ClientDmTemplatesProjection> {
  const supabase = createSupabaseClient();
  const username = readString(usernameHint)
    || await loadCanonicalIgAccountUsername(supabase, accountId)
    || "Instagram account";
  const [domain, packageCode] = await Promise.all([
    buildDmProjection(supabase, accountId),
    resolveAccountPackageCode(accountId),
  ]);
  return projectClientDmTemplates({
    accountId,
    username,
    packageCode,
    domain,
  });
}
