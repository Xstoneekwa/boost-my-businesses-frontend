import "server-only";

import { requireCommercialCrmAccess } from "./crm-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CommercialInstagramResolver, enforceChainSafety, type InstagramMatch } from "./structured-instagram-resolver";
import { fetchOfficialSite, safeSiteGet } from "./structured-site-fetch";
import { targetedSearch, type SearchResult } from "./resolver-search";
import { SIRENE_ALIAS_TARGETS } from "./sirene-alias-diagnostic-contract";
import type { StructuredCandidate } from "./structured-discovery-contract";
import type { BusinessResolution } from "./business-resolution-v2";

export const RESOLVER_POST_V3A_KEY = "commercial-resolver-v2-post-v3a-targeted-v1";

type Input = {
  itemId: string;
  businessId: string;
  siret: string;
  hash: string;
  candidate: StructuredCandidate;
  previous: InstagramMatch | null;
  v3aAliases: unknown[];
};

type ControlResult = { replay: boolean; status: string; inputs: Input[] };

async function control(actor: string, action: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await createSupabaseAdminClient().rpc("commercial_resolver_v2_post_v3a_control", {
    p_actor_user_id: actor,
    p_action: action,
    ...extra,
  });
  if (error) throw new Error("resolver_post_v3a_control_failed");
  return data as ControlResult;
}

export async function startResolverPostV3A() {
  const actor = await requireCommercialCrmAccess();
  const result = await control(actor.userId, "start");
  return { ...result, actorId: actor.userId };
}

function assertFixedInputs(inputs: Input[]) {
  if (inputs.length !== SIRENE_ALIAS_TARGETS.length) throw new Error("resolver_post_v3a_exact_four_required");
  for (const target of SIRENE_ALIAS_TARGETS) {
    const input = inputs.find((candidate) => candidate.itemId === target.itemId);
    if (!input || input.businessId !== target.businessId || input.siret !== target.siret || input.candidate.externalId !== target.siret) {
      throw new Error("resolver_post_v3a_target_not_authorized");
    }
  }
}

/** Executes only the four fixed post-V3A identities. No Sirene, AI, leads or transports. */
export async function executeResolverPostV3A(actor: string, inputs: Input[]) {
  assertFixedInputs(inputs);
  const resolver = new CommercialInstagramResolver();
  const results: Array<{ itemId: string; businessId: string; resolution: BusinessResolution; search: SearchResult }> = [];
  const started = Date.now();
  try {
    // Sequential calls make the append-only ledger deterministic and prevent a hidden fifth target.
    for (const input of inputs) {
      if (Date.now() - started > 240_000) throw new Error("resolver_post_v3a_deadline");
      let search: SearchResult = { outcome: "EMPTY_RESULTS", hits: [], reason: "not_called" };
      const robotsCache = new Map<string, { status: number; text: string }>();
      const reserve = async (kind: string, key: string) => {
        await control(actor, "reserve", { p_item_id: input.itemId, p_kind: kind, p_key: key });
      };
      const record = async (kind: string, key: string, payload: Record<string, unknown>) => {
        await control(actor, "record", { p_item_id: input.itemId, p_kind: kind, p_key: key, p_payload: payload });
      };
      const resolution = await resolver.resolveV2(input.candidate, {
        previous: input.previous ?? undefined,
        search: async (query) => {
          await reserve("search", query);
          const startedAt = Date.now();
          search = await targetedSearch(
            query,
            process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY?.trim() || process.env.TARGET_AI_SEARCHAPI_KEY?.trim() || "",
          );
          await record("search", query, {
            outcome: search.outcome,
            reason: search.reason,
            httpStatus: search.httpStatus,
            durationMs: Date.now() - startedAt,
          });
          return search.hits;
        },
        site: async (url) => fetchOfficialSite(url, async (target) => {
          const kind = new URL(target).pathname === "/robots.txt" ? "robots" : "page";
          if (kind === "robots" && robotsCache.has(target)) return robotsCache.get(target)!;
          await reserve(kind, target);
          const startedAt = Date.now();
          try {
            const response = await safeSiteGet(target);
            if (kind === "robots") robotsCache.set(target, response);
            await record(kind, target, {
              outcome: response.status === 200 ? "SUCCESS" : "HTTP_ERROR",
              httpStatus: response.status,
              reason: `http_${response.status}`,
              durationMs: Date.now() - startedAt,
            });
            return response;
          } catch (error) {
            await record(kind, target, {
              outcome: error instanceof Error && error.message === "site_timeout" ? "TIMEOUT" : "SITE_ERROR",
              reason: error instanceof Error && /^site_[a-z_]+$/.test(error.message) ? error.message : "network_failure",
              durationMs: Date.now() - startedAt,
            });
            throw error;
          }
        }),
      });
      results.push({ itemId: input.itemId, businessId: input.businessId, resolution, search });
    }

    const safe = enforceChainSafety(results.map((result) => ({ candidate: inputs.find((input) => input.itemId === result.itemId)!.candidate, match: result.resolution.match })));
    results.forEach((result, index) => {
      result.resolution.match = safe[index].match;
      if (safe[index].match.reason === "SHARED_BRAND_PROFILE") {
        result.resolution.profileScope = "SHARED_BRAND_PROFILE";
        result.resolution.evidence.push({
          type: "SHARED_BRAND_PROFILE",
          source: "targeted_post_v3a_cohort",
          reference: "same handle across distinct establishment identities",
          strength: "NEGATIVE",
          observed_at: new Date().toISOString(),
        });
      }
    });
    await control(actor, "complete", { p_payload: { results } });
  } catch {
    await control(actor, "fail");
  }
}
