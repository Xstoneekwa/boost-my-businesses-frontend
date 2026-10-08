export type WebArchiveSurface = "admin" | "client";

export type WebArchiveIntent = {
  archiveIntentId: string;
  accountId: string;
  ids: string[];
  surface: WebArchiveSurface;
  createdAt: string;
};

const PREFIX = "bmb.web-archive-intent.v1:";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedIds(ids: string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
}

function storageKey(surface: WebArchiveSurface, accountId: string, ids: string[]) {
  return `${PREFIX}${surface}:${accountId.trim()}:${normalizedIds(ids).join(",")}`;
}

export function prepareWebArchiveIntent(
  storage: Pick<Storage, "getItem" | "setItem">,
  surface: WebArchiveSurface,
  accountId: string,
  ids: string[],
  createUuid: () => string = () => crypto.randomUUID(),
  now: () => Date = () => new Date(),
): WebArchiveIntent {
  const normalizedAccountId = accountId.trim();
  const targets = normalizedIds(ids);
  if (!normalizedAccountId || targets.length === 0) throw new Error("archive_intent_scope_invalid");

  const key = storageKey(surface, normalizedAccountId, targets);
  const priorRaw = storage.getItem(key);
  if (priorRaw) {
    try {
      const prior = JSON.parse(priorRaw) as WebArchiveIntent;
      if (
        prior.surface === surface
        && prior.accountId === normalizedAccountId
        && JSON.stringify(prior.ids) === JSON.stringify(targets)
        && UUID_V4.test(prior.archiveIntentId)
      ) {
        return prior;
      }
    } catch {
      // Replace corrupt, non-secret local metadata with a fresh confirmed intent.
    }
  }

  const archiveIntentId = createUuid();
  if (!UUID_V4.test(archiveIntentId)) throw new Error("archive_intent_uuid_invalid");
  const intent: WebArchiveIntent = {
    archiveIntentId,
    accountId: normalizedAccountId,
    ids: targets,
    surface,
    createdAt: now().toISOString(),
  };
  storage.setItem(key, JSON.stringify(intent));
  return intent;
}

export function clearWebArchiveIntent(
  storage: Pick<Storage, "removeItem">,
  intent: Pick<WebArchiveIntent, "surface" | "accountId" | "ids">,
) {
  storage.removeItem(storageKey(intent.surface, intent.accountId, intent.ids));
}
