import "server-only";
import { SireneProvider } from "./sirene-provider";
import { assertSireneAliasTarget } from "./sirene-alias-diagnostic-contract";
import { parseSireneAliases, SIRENE_DETAIL_BASE, SireneSchemaError } from "./sirene-alias-parser";

/** Dedicated server-side capability, separate from discovery/pagination. */
export class SireneExactProvider extends SireneProvider {
  async getEstablishmentBySiret(input: Parameters<typeof assertSireneAliasTarget>[0], apiKey: string, observedAt: string, fetcher: typeof fetch = fetch) {
    const { siret } = assertSireneAliasTarget(input);
    if (!apiKey.trim()) throw new Error("sirene_configuration_missing");
    const endpoint = `${SIRENE_DETAIL_BASE}${siret}`;
    let response: Response;
    try {
      response = await fetcher(endpoint, { headers: { "X-INSEE-Api-Key-Integration": apiKey.trim(), Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) });
    } catch { throw new Error("sirene_network_failure"); }
    if (response.status !== 200) throw new Error(`sirene_http_${response.status}`);
    if (response.url !== endpoint || response.redirected) throw new SireneSchemaError(["response.endpoint_3_11_exact"]);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new SireneSchemaError(["response.json"]); }
    return parseSireneAliases(payload, siret, observedAt);
  }
}
