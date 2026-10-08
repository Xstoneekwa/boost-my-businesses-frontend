import "server-only";
import { commercialDemoBookingUrl } from "./booking-config";
import { createHash, randomUUID } from "node:crypto";
import { requireCommercialCrmAccess } from "./crm-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  emptyFollowup,
  reduceFollowup,
  requireMarket,
  normalizePhone,
  localToInstant,
  instant,
  MARKETS,
  ACTIONS,
  type Command,
  type Context,
  type FollowupState,
  type Market,
} from "./followup-domain";
import {
  normalizeCalendly,
  normalizeOnoff,
  object,
  str,
  type Json,
} from "./followup-providers";
type DB = ReturnType<typeof createSupabaseAdminClient>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = (value: unknown) => {
  const v = str(value, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  )
    throw new Error("invalid_uuid");
  return v;
};
function checked<T>(result: { data: T; error: unknown }, nullable: true): T;
function checked<T>(result: { data: T; error: unknown }): NonNullable<T>;
function checked<T>(result: { data: T; error: unknown }, nullable = false): T {
  if (result.error || (!nullable && result.data == null))
    throw new Error("commercial_followup_storage_unavailable");
  return result.data;
}
export async function loadFollowupContext(
  db: DB,
  leadId: string,
  owner: string,
) {
  const lead = checked(
    await db
      .from("commercial_leads")
      .select(
        "id,campaign_id,business_id,primary_contact_id,score,outreach_channel,message_angle,sales_status,city_snapshot,subsegment_snapshot,personalization_context_safe",
      )
      .eq("id", uuid(leadId))
      .single(),
  );
  const business = checked(
    await db
      .from("commercial_businesses")
      .select(
        "id,business_name,country_code,phone,email,city,vertical,subsegment,instagram_handle,website",
      )
      .eq("id", lead.business_id)
      .single(),
  );
  const contact = lead.primary_contact_id
    ? checked(
        await db
          .from("commercial_contacts")
          .select("id,email,phone,instagram_handle")
          .eq("id", lead.primary_contact_id)
          .eq("business_id", lead.business_id)
          .single(),
      )
    : null;
  const market = requireMarket(business.country_code);
  const work = checked(
    await db
      .from("commercial_followup_workflows")
      .select("version,state,cold_suspended")
      .eq("lead_id", leadId)
      .maybeSingle(),
    true,
  );
  const phone = normalizePhone(contact?.phone ?? business.phone ?? "", market);
  return {
    lead,
    business,
    contact,
    version: work?.version ?? 0,
    state: (work?.state ?? emptyFollowup()) as FollowupState,
    coldSuspended: work?.cold_suspended ?? false,
    context: {
      market,
      owner,
      now: new Date().toISOString(),
      eventId: randomUUID(),
      email: contact?.email ?? business.email ?? null,
      phone,
    } satisfies Context,
  };
}
async function commit(
  db: DB,
  actor: string,
  leadId: string | null,
  version: number,
  key: string,
  input: unknown,
  operation: string,
  state: FollowupState | null,
  metadata: Json = {},
) {
  const result = await db.rpc("commit_commercial_followup_v1", {
    p_actor_user_id: actor,
    p_lead_id: leadId,
    p_expected_version: version,
    p_source_key: key,
    p_payload_hash: hash(input),
    p_operation: operation,
    p_state: state,
    p_metadata_safe: metadata,
  });
  if (result.error) {
    if (result.error.code === "40001")
      throw new Error("followup_conflict_reload");
    throw new Error("commercial_followup_commit_failed");
  }
  return result.data;
}
async function apply(
  db: DB,
  actor: string,
  leadId: string,
  key: string,
  input: unknown,
  command: Command,
) {
  const previous = checked(
    await db
      .from("commercial_followup_receipts")
      .select("payload_hash,lead_id")
      .eq("source_key", key)
      .maybeSingle(),
    true,
  );
  if (previous) {
    if (previous.payload_hash !== hash(input) || previous.lead_id !== leadId)
      throw new Error("idempotency_conflict");
    return { duplicate: true, lead_id: leadId };
  }
  const loaded = await loadFollowupContext(db, leadId, actor);
  if (command.kind === "booking") {
    const existing = loaded.state.bookings.find(b => b.id === command.booking.id || b.id === command.booking.old_invitee);
    const items = checked(await db.from("commercial_outreach_items")
      .select("id,channel,angle,template_version,generation_prompt_version,generated_at,state")
      .eq("lead_id", leadId).neq("state", "cancelled").is("superseded_by", null).limit(2));
    const item = items.length === 1 ? items[0] : null;
    const source = loaded.lead.personalization_context_safe as Json | null;
    command.booking.attribution = existing?.attribution ?? {
      campaign_id: loaded.lead.campaign_id, market: loaded.context.market,
      city: loaded.lead.city_snapshot, vertical: loaded.business.vertical, subsegment: loaded.lead.subsegment_snapshot,
      outreach_channel: item?.channel ?? loaded.lead.outreach_channel,
      angle: item?.angle ?? loaded.lead.message_angle,
      template_version: item?.template_version ?? null,
      outreach_item_id: item?.id ?? null,
      source_message_id: source?.source_message_id ?? null,
      instagram_sender_account_id: source?.instagram_sender_account_id ?? null,
      attribution_status: item ? "unique_outreach_path" : "no_unique_outreach_path",
    };
  }
  const reduced = reduceFollowup(loaded.state, command, loaded.context);
  if (
    reduced.event === "reply_already_classified" ||
    reduced.event === "duplicate_reply"
  )
    return { duplicate: true, lead_id: leadId };
  return commit(
    db,
    actor,
    leadId,
    loaded.version,
    key,
    input,
    reduced.event,
    reduced.state,
    {
      source_event_id: loaded.context.eventId,
      market: loaded.context.market,
      channel: loaded.lead.outreach_channel,
      angle: loaded.lead.message_angle,
      ...("disposition" in command ? { disposition: command.disposition } : {}),
    },
  );
}
async function matchContact(
  db: DB,
  channel: "email" | "instagram" | "phone",
  address: string,
  market?: Market,
  strictAmbiguity = false,
) {
  let contacts: Json[] = [];
  if (channel === "instagram") {
    // A single contact row must not hide another establishment using the same
    // network profile. Legacy-only attribution retains its existing behavior.
    const businesses = checked(await db.from("commercial_businesses")
      .select("id,identity_mode").eq("instagram_handle_normalized", address).limit(3));
    if (businesses.some(b => b.identity_mode === "structured") && businesses.length > 1) {
      if (strictAmbiguity) throw new Error("booking_identity_ambiguous");
      return null;
    }
  }
  if (channel === "phone") {
    // The canonical legacy column isn't E.164-aware. Bound candidates and fail closed on overflow.
    const rows = checked(
      await db
        .from("commercial_contacts")
        .select("id,business_id,phone")
        .not("phone", "is", null)
        .limit(501),
    );
    if (rows.length > 500) throw new Error("phone_match_index_required");
    contacts = rows.filter(
      (r) => normalizePhone(r.phone, market ?? "FR") === address,
    );
  } else {
    const column =
      channel === "email" ? "email_normalized" : "instagram_handle_normalized";
    contacts = checked(
      await db
        .from("commercial_contacts")
        .select("id,business_id")
        .eq(column, address)
        .limit(3),
    );
  }
  if (contacts.length === 0) {
    let candidates: Json[];
    if (channel === "phone") {
      const rows = checked(await db.from("commercial_businesses").select("id,phone,country_code").eq("country_code", market ?? "FR").not("phone", "is", null).limit(501));
      if (rows.length > 500) throw new Error("phone_match_index_required");
      candidates = rows.filter(b => normalizePhone(b.phone, requireMarket(b.country_code)) === address);
    } else {
      candidates = checked(await db.from("commercial_businesses").select("id").eq(channel === "email" ? "email" : "instagram_handle", address).limit(3));
    }
    if (strictAmbiguity && candidates.length > 1) throw new Error("booking_identity_ambiguous");
    if (candidates.length === 1) contacts = [{id: null, business_id: candidates[0].id}];
  }
  if (strictAmbiguity && contacts.length > 1) throw new Error("booking_identity_ambiguous");
  if (contacts.length !== 1) return null;
  const leads = checked(
    await db
      .from("commercial_leads")
      .select("id,business_id")
      .eq("business_id", contacts[0].business_id)
      .not("sales_status", "in", "(lost,paid,onboarding,active_client)")
      .limit(3),
  );
  if (strictAmbiguity && leads.length > 1) throw new Error("booking_identity_ambiguous");
  if (leads.length !== 1) return null;
  return { leadId: leads[0].id as string, contactId: contacts[0].id as string | null };
}
export async function ingestFollowup(value: unknown, actorOverride?: string) {
  const actor = actorOverride ?? (await requireCommercialCrmAccess()).userId;
  const input = object(value),
    provider = str(input.provider);
  const db = createSupabaseAdminClient();
  let command: Command;
  let match: { leadId: string; contactId: string | null } | null;
  let key: string;
  let metadata: Json;
  if (provider === "onoff") {
    const normalized = normalizeOnoff(input.payload, randomUUID());
    key = normalized.key;
    metadata = normalized.safeRaw;
    match = await matchContact(db, "phone", normalized.phone, "FR");
    command = { kind: "call", call: normalized.call };
  } else if (provider === "calendly") {
    const payload = object(object(input.payload).payload);
    const email = str(payload.email, 320).toLowerCase();
    // Use only documented structured phone, never guess a phone from arbitrary answers.
    try {
      match = await matchContact(db, "email", email, undefined, true);
      if (payload.text_reminder_number) {
        const raw = str(payload.text_reminder_number, 64).replace(/[\s().-]/g, "");
        const phoneMarket = raw.startsWith("+33") ? "FR" : raw.startsWith("+27") ? "ZA" : null;
        const phone = phoneMarket ? normalizePhone(raw, phoneMarket) : null;
        if (phone && phoneMarket) {
          const phoneMatch = await matchContact(db, "phone", phone, phoneMarket, true);
          if (match && phoneMatch && match.leadId !== phoneMatch.leadId) throw new Error("booking_identity_ambiguous");
          match = match ?? phoneMatch;
        }
      }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "booking_identity_ambiguous") throw error;
      const unmatched = normalizeCalendly(input.payload, "ZA");
      return commit(db, actor, null, 0, unmatched.key, input, "unmatched", null, { ...unmatched.safeRaw, reason: "booking_identity_ambiguous" });
    }
    const market = match
      ? (await loadFollowupContext(db, match.leadId, actor)).context.market
      : "ZA";
    const n = normalizeCalendly(input.payload, market);
    key = n.key;
    metadata = n.safeRaw;
    command = { kind: "booking", booking: n.booking };
    // Canonical invitee identity also resolves cancellation when email has changed.
    for (const invitee of [n.booking.id, n.booking.old_invitee].filter(Boolean)) {
      const works = checked(
        await db
          .from("commercial_followup_workflows")
          .select("lead_id,state")
          .contains("state", { bookings: [{ id: invitee }] })
          .limit(2),
      );
      if (works.length === 1 && (!match || works[0].lead_id === match.leadId))
        match = { leadId: works[0].lead_id, contactId: match?.contactId ?? null };
      else if (works.length) { match = null; break; }
    }
    if (match && !payload.timezone) {
      const resolved = await loadFollowupContext(db, match.leadId, actor);
      command.booking.timezone = MARKETS[resolved.context.market].timezone;
    }
  } else if (provider === "reply") {
    const p = object(input.payload);
    const channel = str(p.channel);
    if (channel !== "email" && channel !== "instagram")
      throw new Error("invalid_reply_channel");
    const address = str(p.address, 320)
      .toLowerCase()
      .replace(channel === "instagram" ? /^@/ : /^$/, "");
    const source = str(p.source_message_id, 160);
    key = `reply:${channel}:${hash([address, source])}`;
    match = await matchContact(db, channel, address);
    metadata = { channel, source_message_id: source, address };
    command = {
      kind: "reply",
      reply: {
        id: key,
        raw_response: str(p.raw_response, 10000),
        channel,
        source_message_id: source,
        conversation_id: str(p.conversation_id, 200),
        contact_id: match?.contactId ?? null,
        outreach_item_id: p.outreach_item_id ? uuid(p.outreach_item_id) : null,
        received_at: instant(str(p.received_at)),
        classification: null,
        confidence: null,
        reasoning_safe: null,
        classifier_version: null,
        human_review_required: true,
      },
    };
  } else throw new Error("unsupported_provider");
  if (!match)
    return commit(db, actor, null, 0, key, input, "unmatched", null, {
      ...metadata,
      reason: "no_unique_canonical_contact_and_lead",
    });
  const receipt = await apply(db, actor, match.leadId, key, input, command);
  // Receipt/suspension is durably committed. A crash/classifier failure leaves a visible REPLY task.
  if (command.kind === "reply") {
    try {
      await apply(
        db,
        actor,
        match.leadId,
        `${key}:classify`,
        { replyId: command.reply.id },
        { kind: "classify", reply_id: command.reply.id },
      );
    } catch {
      return { ...receipt, classification_pending: true };
    }
  }
  return receipt;
}
export async function mutateFollowup(leadId: string, value: unknown) {
  const actor = (await requireCommercialCrmAccess()).userId;
  const input = object(value),
    kind = str(input.kind);
  const key = `followup:${uuid(input.idempotencyKey)}`;
  const db = createSupabaseAdminClient();
  const loaded = await loadFollowupContext(db, leadId, actor);
  const zone = MARKETS[loaded.context.market].timezone;
  const due = () =>
    input.local_time
      ? localToInstant(str(input.local_time), zone)
      : instant(str(input.due_at));
  let command: Command;
  if (kind === "pre_call_disposition") {
    const disposition = str(input.disposition);
    if (!["completed", "no_answer", "skipped"].includes(disposition)) throw new Error("invalid_pre_call_disposition");
    command = { kind, booking_id: str(input.booking_id), disposition: disposition as "completed" | "no_answer" | "skipped" };
  } else if (kind === "next_action") {
    const type = str(input.action_type);
    if (!ACTIONS.includes(type as (typeof ACTIONS)[number]))
      throw new Error("invalid_action");
    command = {
      kind,
      action_type: type as (typeof ACTIONS)[number],
      due_at: due(),
      reason: str(input.reason, 500),
    };
  } else if (kind === "action_status") {
    const status = str(input.status);
    if (status !== "completed" && status !== "cancelled")
      throw new Error("invalid_status");
    command = { kind, action_id: str(input.action_id), status };
  } else if (kind === "classify")
    command = { kind, reply_id: str(input.reply_id) };
  else if (kind === "call_disposition") {
    const disposition = str(input.disposition);
    if (
      ![
        "INTERESTED",
        "CALLBACK",
        "DEMO_BOOKED",
        "NOT_INTERESTED",
        "NO_ANSWER",
        "OTHER",
      ].includes(disposition)
    )
      throw new Error("invalid_disposition");
    command = {
      kind,
      call_id: str(input.call_id),
      disposition: disposition as Extract<
        Command,
        { kind: "call_disposition" }
      >["disposition"],
      ...(disposition === "CALLBACK" ? { due_at: due() } : {}),
    };
  } else if (kind === "manual_call_fixture") {
    if (loaded.context.market !== "ZA")
      throw new Error("local_call_requires_ZA");
    const start = instant(str(input.started_at)),
      end = instant(str(input.ended_at));
    if (end < start) throw new Error("invalid_call_times");
    const status = str(input.status);
    if (!["ANSWERED", "NO_ANSWER"].includes(status))
      throw new Error("invalid_call_status");
    command = {
      kind: "call",
      call: {
        id: key,
        provider: "local_manual",
        direction: "OUTBOUND",
        status,
        started_at: start,
        ended_at: end,
        duration: null,
        recording_reference: null,
        source_event_id: loaded.context.eventId,
      },
    };
  } else if (kind === "demo_disposition") {
    const disposition = str(input.disposition);
    if (
      !["INTERESTED", "FOLLOW_UP_NEEDED", "NOT_INTERESTED", "NO_SHOW"].includes(
        disposition,
      )
    )
      throw new Error("invalid_disposition");
    command = {
      kind,
      booking_id: str(input.booking_id),
      disposition: disposition as Extract<
        Command,
        { kind: "demo_disposition" }
      >["disposition"],
    };
  } else if (kind === "simulate_notification")
    command = { kind, notification_id: str(input.notification_id) };
  else throw new Error("unsupported_followup_action");
  return apply(db, actor, leadId, key, input, command);
}
export async function getFollowup(leadId: string) {
  const actor = (await requireCommercialCrmAccess()).userId;
  const db = createSupabaseAdminClient();
  const result = await loadFollowupContext(db, leadId, actor);
  const outreach = checked(
    await db
      .from("commercial_outreach_items")
      .select("id,body,channel,angle,approved_at").is("superseded_by", null)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1),
  );
  return { ...result, outreach: outreach[0] ?? null, bookingUrl: commercialDemoBookingUrl() };
}
export async function getFollowupQueue(market?: Market) {
  await requireCommercialCrmAccess();
  const db = createSupabaseAdminClient();
  const works = checked(
    await db
      .from("commercial_followup_workflows")
      .select("lead_id,state,updated_at")
      .order("updated_at", { ascending: false })
      .limit(251),
  );
  if (works.length > 250) throw new Error("followup_queue_pagination_required");
  const items = await Promise.all(
    works.map(async (w) => {
      const lead = checked(
        await db
          .from("commercial_leads")
          .select("id,business_id,outreach_channel,message_angle,sales_status")
          .eq("id", w.lead_id)
          .single(),
      );
      const business = checked(
        await db
          .from("commercial_businesses")
          .select("business_name,country_code,city")
          .eq("id", lead.business_id)
          .single(),
      );
      return { lead, business, state: w.state as FollowupState };
    }),
  );
  const unmatched = checked(
    await db
      .from("commercial_followup_receipts")
      .select("id,operation,metadata_safe,created_at")
      .eq("status", "unmatched")
      .order("created_at", { ascending: false })
      .limit(30),
  );
  return {
    items: items.filter((i) => !market || i.business.country_code === market),
    unmatched,
  };
}
