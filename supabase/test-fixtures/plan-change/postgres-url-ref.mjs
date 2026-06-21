/**
 * Extract Supabase project ref from PostgreSQL connection strings.
 * Supports URI and libpq keyword/value formats. Never logs credentials.
 */

import { readFileSync } from "node:fs";

/** @typedef {'uri' | 'libpq'} ConnectionFormat */
/** @typedef {'direct' | 'session_pooler'} ConnectionKind */
/** @typedef {{ ok: true, projectRef: string, format: ConnectionFormat, connectionKind: ConnectionKind, ref: string }} ExtractOk */
/** @typedef {{ ok: false, code: string, message: string }} ExtractErr */

export const GENERIC_INVALID =
  "Cannot parse project ref from database URL (URL not logged)";
export const GENERIC_NON_SUPABASE = "Non-Supabase database URL refused (URL not logged)";
export const GENERIC_REF_MISMATCH =
  "Project ref in connection parts do not match (URL not logged)";
export const GENERIC_TRANSACTION_POOLER =
  "Use Direct connection or Session Pooler on port 5432 (Transaction Pooler port 6543 not supported)";

const DIRECT_HOST = /^db\.([a-z0-9]+)\.supabase\.co$/i;
const POOLER_HOST = /\.pooler\.supabase\.com$/i;
const USERNAME_REF = /^[^.]+\.([a-z0-9]+)$/i;

/**
 * @param {string} input
 * @returns {'uri' | 'libpq' | 'psql_command' | 'unknown'}
 */
export function detectConnectionFormat(input) {
  const trimmed = input.trim();
  if (!trimmed) return "unknown";
  if (/^\s*psql\s+/i.test(trimmed)) return "psql_command";
  if (/^postgres(?:ql)?:\/\//i.test(trimmed)) return "uri";
  if (/=/.test(trimmed) && /\b(host|hostaddr|user|port|dbname|password|sslmode)=/i.test(trimmed)) {
    return "libpq";
  }
  return "unknown";
}

/**
 * @param {string} input
 * @returns {{ ok: true, params: Record<string, string> } | { ok: false }}
 */
export function parseLibpqConnectionString(input) {
  /** @type {Record<string, string>} */
  const params = {};
  let i = 0;
  const len = input.length;

  while (i < len) {
    while (i < len && /\s/.test(input[i])) i += 1;
    if (i >= len) break;

    const keyStart = i;
    while (i < len && input[i] !== "=" && !/\s/.test(input[i])) i += 1;
    if (i >= len || input[i] !== "=") {
      return { ok: false };
    }

    const key = input.slice(keyStart, i).toLowerCase();
    i += 1;

    let value = "";
    if (input[i] === "'" || input[i] === '"') {
      const quote = input[i];
      i += 1;
      while (i < len) {
        if (input[i] === quote) {
          if (input[i + 1] === quote) {
            value += quote;
            i += 2;
          } else {
            i += 1;
            break;
          }
        } else {
          value += input[i];
          i += 1;
        }
      }
    } else {
      while (i < len && !/\s/.test(input[i])) {
        value += input[i];
        i += 1;
      }
    }

    params[key] = value;
  }

  if (!Object.keys(params).length) {
    return { ok: false };
  }

  return { ok: true, params };
}

/**
 * @param {{ hostname: string, port: string, username: string }} parts
 * @returns {ExtractOk | ExtractErr}
 */
export function resolveSupabaseProjectRefFromParts(parts) {
  const hostname = parts.hostname.trim();
  const port = parts.port.trim() || "5432";
  const username = parts.username.trim();

  /** @type {string | null} */
  let hostRef = null;
  const directMatch = hostname.match(DIRECT_HOST);
  if (directMatch) {
    hostRef = directMatch[1].toLowerCase();
  }

  const isPoolerHost = POOLER_HOST.test(hostname);

  /** @type {string | null} */
  let usernameRef = null;
  const userMatch = username.match(USERNAME_REF);
  if (userMatch) {
    usernameRef = userMatch[1].toLowerCase();
  }

  if (isPoolerHost) {
    if (port === "6543") {
      return {
        ok: false,
        code: "transaction_pooler",
        message: GENERIC_TRANSACTION_POOLER,
      };
    }
    if (port !== "5432") {
      return { ok: false, code: "invalid_pooler_port", message: GENERIC_INVALID };
    }
    if (!usernameRef) {
      return { ok: false, code: "ref_not_found", message: GENERIC_INVALID };
    }
    return {
      ok: true,
      projectRef: usernameRef,
      ref: usernameRef,
      connectionKind: "session_pooler",
    };
  }

  if (hostRef) {
    if (usernameRef && usernameRef !== hostRef) {
      return { ok: false, code: "ref_mismatch", message: GENERIC_REF_MISMATCH };
    }
    return {
      ok: true,
      projectRef: hostRef,
      ref: hostRef,
      connectionKind: "direct",
    };
  }

  return { ok: false, code: "non_supabase", message: GENERIC_NON_SUPABASE };
}

/**
 * @param {string} databaseUrl
 * @returns {ExtractOk | ExtractErr}
 */
function parseUriConnection(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl.replace(/^postgres:/i, "postgresql:"));
  } catch {
    return { ok: false, code: "invalid_url", message: GENERIC_INVALID };
  }

  if (parsed.protocol !== "postgresql:") {
    return { ok: false, code: "non_supabase", message: GENERIC_NON_SUPABASE };
  }

  const resolved = resolveSupabaseProjectRefFromParts({
    hostname: parsed.hostname,
    port: parsed.port || "5432",
    username: decodeURIComponent(parsed.username || ""),
  });

  if (!resolved.ok) {
    return resolved;
  }

  const connectionKind = POOLER_HOST.test(parsed.hostname) ? "session_pooler" : "direct";
  return {
    ok: true,
    projectRef: resolved.projectRef,
    ref: resolved.projectRef,
    format: "uri",
    connectionKind,
  };
}

/**
 * @param {string} input
 * @returns {ExtractOk | ExtractErr}
 */
function parseLibpqConnection(input) {
  const parsed = parseLibpqConnectionString(input);
  if (!parsed.ok) {
    return { ok: false, code: "invalid_libpq", message: GENERIC_INVALID };
  }

  const hostname = parsed.params.host || parsed.params.hostaddr || "";
  const port = parsed.params.port || "5432";
  const username = parsed.params.user || "";

  if (!hostname || !username) {
    return { ok: false, code: "missing_libpq_fields", message: GENERIC_INVALID };
  }

  const resolved = resolveSupabaseProjectRefFromParts({ hostname, port, username });
  if (!resolved.ok) {
    return resolved;
  }

  return {
    ok: true,
    projectRef: resolved.projectRef,
    ref: resolved.projectRef,
    format: "libpq",
    connectionKind: resolved.connectionKind,
  };
}

/**
 * @param {string} input
 * @returns {ExtractOk | ExtractErr}
 */
export function parsePostgresConnectionInput(input) {
  if (!input || typeof input !== "string" || !input.trim()) {
    return { ok: false, code: "invalid_url", message: GENERIC_INVALID };
  }

  const format = detectConnectionFormat(input);
  if (format === "psql_command") {
    return { ok: false, code: "psql_command", message: GENERIC_INVALID };
  }
  if (format === "uri") {
    return parseUriConnection(input.trim());
  }
  if (format === "libpq") {
    return parseLibpqConnection(input.trim());
  }

  return { ok: false, code: "unknown_format", message: GENERIC_INVALID };
}

/**
 * @param {string} databaseUrl
 * @returns {ExtractOk | ExtractErr}
 */
export function extractSupabaseProjectRefFromDatabaseUrl(databaseUrl) {
  return parsePostgresConnectionInput(databaseUrl);
}

/**
 * @param {string} databaseUrl
 * @returns {string}
 */
export function extractRefOrThrow(databaseUrl) {
  const result = parsePostgresConnectionInput(databaseUrl);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.projectRef;
}

function main() {
  const mode = process.argv[2];
  const input = mode === "--extract-stdin" ? readFileSync(0, "utf8").trim() : "";

  if (!input) {
    console.error(GENERIC_INVALID);
    process.exit(1);
  }

  const result = parsePostgresConnectionInput(input);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  process.stdout.write(result.projectRef);
}

const isMain = process.argv[1] && process.argv[1].endsWith("postgres-url-ref.mjs");
if (isMain) {
  try {
    main();
  } catch {
    console.error(GENERIC_INVALID);
    process.exit(1);
  }
}
