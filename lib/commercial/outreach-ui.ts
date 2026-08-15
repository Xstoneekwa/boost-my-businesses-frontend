import type {
  CommercialOutreachItem,
  CommercialOutreachQueueItem,
  CommercialOutreachState,
  CommercialOutreachStatusTab,
} from "./outreach-contract";

const TAB_STATE: Partial<Record<CommercialOutreachStatusTab, CommercialOutreachState>> = {
  ready: "ready_for_review",
  approved: "queued_dry_run",
  failed: "generation_failed",
  cancelled: "cancelled",
};

export function outreachTabMatchesState(tab: CommercialOutreachStatusTab, state: CommercialOutreachState) {
  return tab === "all" || TAB_STATE[tab] === state;
}

export function filterOutreachQueueItems(items: CommercialOutreachQueueItem[], search: string) {
  const needle = search.normalize("NFKC").trim().toLocaleLowerCase("en-ZA");
  if (!needle) return items;
  return items.filter((item) => [item.businessName, item.city, item.subsegment, item.messageExcerpt]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-ZA")
    .includes(needle));
}

export function nextOutreachItemId(items: CommercialOutreachQueueItem[], selectedId: string | null, direction: -1 | 1) {
  if (!items.length) return null;
  const currentIndex = Math.max(0, items.findIndex((item) => item.id === selectedId));
  return items[Math.min(items.length - 1, Math.max(0, currentIndex + direction))]?.id ?? null;
}

export function outreachActionAvailability(item: CommercialOutreachItem | null) {
  return {
    approve: item?.state === "ready_for_review",
    edit: item?.state === "ready_for_review",
    regenerate: Boolean(item && !["cancelled", "generating"].includes(item.state)),
    cancel: Boolean(item && item.state !== "cancelled"),
    changeSelection: Boolean(item && item.state !== "cancelled"),
  };
}

export function outreachStateLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
