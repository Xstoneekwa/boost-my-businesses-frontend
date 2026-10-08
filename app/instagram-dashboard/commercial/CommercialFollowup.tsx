"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MARKETS,
  type Market,
} from "@/lib/commercial/followup-domain";
import type {
  getFollowup,
  getFollowupQueue,
} from "@/lib/commercial/followup-service";
type Detail = Awaited<ReturnType<typeof getFollowup>>;
type Queue = Awaited<ReturnType<typeof getFollowupQueue>>;
function date(time: string, zone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(time));
}
async function read(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok || !body.ok)
    throw new Error(body.code ?? "Commercial follow-up is unavailable.");
  return body.data;
}
export default function CommercialFollowup({ leadId }: { leadId?: string }) {
  const [market, setMarket] = useState<Market | "">("");
  const [queue, setQueue] = useState<Queue | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState("");
  const [action, setAction] = useState("CALLBACK");
  const [certification, setCertification] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Array<{ template_version: string; prompt_version: string; language: string; subject: string | null; body: string }>>([]);
  const router = useRouter();
  const base = "/api/instagram-dashboard/commercial";
  const reload = useCallback(async () => {
    try {
      if (leadId) setDetail(await read(`${base}/leads/${leadId}/followup`));
      else
        setQueue(
          await read(`${base}/followup${market ? `?market=${market}` : ""}`),
        );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unavailable");
    }
  }, [leadId, market]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function mutate(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await readMutation(`${base}/leads/${leadId}/followup`, payload);
      await reload();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="followup" id="human-followup">
      <header>
        <div>
          <small>HUMAN SALES · DRY RUN</small>
          <h2>{leadId ? "Direct booking → Optional human pre-call → Demo" : "What needs me"}</h2>
        </div>
        <span>Calls by Liam · Delivery locked</span>
      </header>
      {!leadId ? <div><button type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const result = await read(`${base}/followup/certification`);
          setPreviews(result.previews ?? []);
          setCertification(result.passed ? `PASS — ${Object.keys(result.checks).length} fixture checks. No CRM writes, no real contact.` : "Fixture certification failed.");
        } catch { setCertification("Certification unavailable — owner access required."); }
        finally { setBusy(false); }
      }}>Run synthetic dry-run certification</button>{certification ? <p role="status">{certification}</p> : null}</div> : null}
      {previews.length ? <details open><summary>New Calendly CTA versions · synthetic previews · human review required</summary>
        <p>No CRM approval or previous approval has been transferred. These examples use a fictional business.</p>
        {previews.map(p => <article key={p.template_version}><h3>{p.template_version} · {p.language}</h3><small>{p.prompt_version}</small><p>{p.subject}</p><p className="followup-copy">{p.body}</p></article>)}
      </details> : null}
      {error ? (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => void reload()}>
            Retry
          </button>
        </p>
      ) : null}
      {!leadId ? (
        <>
          <label>
            Market{" "}
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value as Market | "")}
            >
              <option value="">All</option>
              <option value="FR">France</option>
              <option value="ZA">South Africa</option>
            </select>
          </label>
          {!queue && !error ? <p>Loading owner queues…</p> : null}
          {queue ? (
            <>
              <div className="followup-columns">
                {(["TO HANDLE", "TO CALL", "TO CLOSE"] as const).map((name) => {
                  const entries = queue.items.flatMap((item) =>
                    item.state.actions
                      .filter(
                        (a) =>
                          a.status === "pending" &&
                          (name === "TO CALL"
                            ? ["CALL", "CALLBACK", "PRE_CALL"].includes(a.action_type)
                            : name === "TO CLOSE"
                              ? a.intention.startsWith("booking:") ||
                                [
                                  "BOOK_DEMO",
                                  "SEND_PRICING",
                                  "CHECK_PAYMENT",
                                ].includes(a.action_type)
                              : !a.intention.startsWith("booking:") &&
                                ![
                                  "CALL",
                                  "CALLBACK",
                                  "PRE_CALL",
                                  "BOOK_DEMO",
                                  "SEND_PRICING",
                                  "CHECK_PAYMENT",
                                ].includes(a.action_type)),
                      )
                      .map((a) => ({ item, a })),
                  ).sort((x, y) => Number(y.a.action_type === "PRE_CALL") - Number(x.a.action_type === "PRE_CALL") || Date.parse(x.a.due_at) - Date.parse(y.a.due_at));
                  return (
                    <div key={name}>
                      <h3>
                        {name} <span>{entries.length}</span>
                      </h3>
                      {entries.length ? (
                        entries.map(({ item, a }) => (
                          <article key={a.id}>
                            <Link
                              href={`/instagram-dashboard/commercial/leads/${item.lead.id}#human-followup`}
                            >
                              {item.business.business_name}
                            </Link>
                            <p>
                              {item.business.country_code} ·{" "}
                              {a.action_type.replaceAll("_", " ")}
                            </p>
                            <time>
                              {date(a.due_at, a.timezone)} ({a.timezone})
                              {Date.parse(a.due_at) < Date.now()
                                ? " · Due"
                                : ""}
                            </time>
                            <p>{a.reason}</p>
                            {item.state.bookings.filter(b => b.status === "active" && ["booking:", "pre_call:"].some(prefix => a.intention === `${prefix}${b.id}`)).map(b => <p key={b.id}>Demo {b.start ? date(b.start, b.timezone) : "time pending"} · Pre-call {b.pre_call_status ?? "optional"}</p>)}
                          </article>
                        ))
                      ) : (
                        <p>No pending action.</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <details>
                <summary>
                  Unmatched provider events ({queue.unmatched.length})
                </summary>
                {queue.unmatched.map((u) => (
                  <p key={u.id}>
                    {u.created_at} · No unique canonical contact/lead match.
                    Reference: {u.id}
                  </p>
                ))}
              </details>
              <details>
                <summary>Funnel activity — recorded data</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th>Replies</th>
                      <th>Positive</th>
                      <th>Calls</th>
                      <th>Demos booked</th>
                      <th>Demos done</th>
                      <th>No-show</th>
                      <th>Interested</th>
                      <th>Paid leads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["FR", "ZA"] as const).map((m) => {
                      const items = queue.items.filter(
                        (i) => i.business.country_code === m,
                      );
                      const replies = items.flatMap((i) => i.state.replies),
                        calls = items.flatMap((i) => i.state.calls),
                        bookings = items.flatMap((i) => i.state.bookings);
                      return (
                        <tr key={m}>
                          <td>{MARKETS[m].label}</td>
                          <td>{replies.length}</td>
                          <td>
                            {
                              replies.filter(
                                (r) => r.classification === "POSITIVE_INTEREST",
                              ).length
                            }
                          </td>
                          <td>{calls.length}</td>
                          <td>
                            {
                              bookings.filter((b) => b.status === "active")
                                .length
                            }
                          </td>
                          <td>
                            {
                              bookings.filter(
                                (b) =>
                                  b.disposition && b.disposition !== "NO_SHOW",
                              ).length
                            }
                          </td>
                          <td>
                            {
                              bookings.filter(
                                (b) => b.disposition === "NO_SHOW",
                              ).length
                            }
                          </td>
                          <td>
                            {
                              bookings.filter(
                                (b) => b.disposition === "INTERESTED",
                              ).length
                            }
                          </td>
                          <td>
                            {
                              items.filter((i) =>
                                [
                                  "paid",
                                  "onboarding",
                                  "active_client",
                                ].includes(i.lead.sales_status),
                              ).length
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </details>
            </>
          ) : null}
        </>
      ) : null}
      {detail ? (
        <>
          <p>
            {detail.business.business_name} · {detail.business.city} ·{" "}
            {detail.business.subsegment} · Score {detail.lead.score ?? "—"}
          </p>
          <p>
            Prospect:{" "}
            {date(detail.context.now, MARKETS[detail.context.market].timezone)}{" "}
            · Liam: {date(detail.context.now, "Africa/Johannesburg")}
          </p>
          <p>
            {detail.context.phone ?? "No confidently normalized phone"} ·{" "}
            {detail.contact
              ? "Contact phone if available; otherwise business phone"
              : "Business phone"}
          </p>
          <button
            disabled
            title="Real prospect calling is OFF during certification"
          >
            {detail.context.market === "FR"
              ? "Call with Onoff"
              : "Call with local line"}{" "}
            — Liam calls manually (OFF)
          </button>
          <p>
            Recommended angle: {detail.lead.message_angle ?? "Not recorded"} ·
            Cold follow-ups:{" "}
            {detail.coldSuspended ? "suspended" : "no reply recorded"}
          </p>
          <details>
            <summary>Original outreach</summary>
            <p className="followup-copy">
              {detail.outreach?.body ?? "No outreach message recorded."}
            </p>
          </details>
          <h3>Responses</h3>
          {detail.state.replies.map((r) => (
            <article key={r.id}>
              <p className="followup-copy">{r.raw_response}</p>
              <small>
                {r.channel} · {r.classification ?? "Awaiting classification"} ·{" "}
                {r.confidence ?? "—"}
              </small>
              <p>{r.reasoning_safe}</p>
              {!r.classification ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate({ kind: "classify", reply_id: r.id })
                  }
                >
                  Classify received reply
                </button>
              ) : null}
            </article>
          ))}
          <h3>Next action</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate({
                kind: "next_action",
                action_type: action,
                local_time: time,
                reason: "Owner scheduled next commercial action",
              });
            }}
          >
            <label>
              Action{" "}
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
              >
                {[
                  "CALL",
                  "CALLBACK",
                  "REPLY",
                  "BOOK_DEMO",
                  "FOLLOW_UP",
                  "SEND_PRICING",
                  "CHECK_PAYMENT",
                ].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <label>
              Prospect local date/time (
              {MARKETS[detail.context.market].timezone}){" "}
              <input
                type="datetime-local"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
            <button disabled={busy || detail.state.do_not_contact}>
              Schedule / replace current action
            </button>
          </form>
          {detail.state.actions
            .filter((a) => a.status === "pending")
            .map((a) => (
              <article key={a.id}>
                <strong>{a.action_type}</strong>
                <p>{a.reason}</p>
                <time>
                  {date(a.due_at, a.timezone)} ({a.timezone})
                </time>
                <div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void mutate({
                        kind: "action_status",
                        action_id: a.id,
                        status: "completed",
                      })
                    }
                  >
                    Mark action complete
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void mutate({
                        kind: "action_status",
                        action_id: a.id,
                        status: "cancelled",
                      })
                    }
                  >
                    Cancel action
                  </button>
                </div>
                {a.action_type === "BOOK_DEMO" ? (
                  <a href={detail.bookingUrl} target="_blank" rel="noreferrer">
                    Open existing Calendly page
                  </a>
                ) : null}
              </article>
            ))}
          <h3>Human calls</h3>
          {detail.state.calls.map((call) => (
            <article key={call.id}>
              <p>
                {call.provider} · {call.status} ·{" "}
                {date(call.started_at, MARKETS[detail.context.market].timezone)}
              </p>
              <p>{call.disposition ?? "Human disposition needed"}</p>
              <div>
                {[
                  "INTERESTED",
                  "CALLBACK",
                  "DEMO_BOOKED",
                  "NOT_INTERESTED",
                  "NO_ANSWER",
                  "OTHER",
                ].map((d) => (
                  <button
                    key={d}
                    disabled={busy || (d === "CALLBACK" && !time)}
                    onClick={() =>
                      void mutate({
                        kind: "call_disposition",
                        call_id: call.id,
                        disposition: d,
                        ...(d === "CALLBACK" ? { local_time: time } : {}),
                      })
                    }
                  >
                    {d.replaceAll("_", " ")}
                  </button>
                ))}
              </div>
            </article>
          ))}
          <h3>Demos</h3>
          {detail.state.bookings.map((b) => (
            <article key={b.id}>
              <p>
                {b.new_invitee && b.status === "cancelled" ? "rescheduled" : b.status === "active" ? "Demo booked" : b.status} ·{" "}
                {b.start
                  ? date(b.start, b.timezone)
                  : "Awaiting booking details"}{" "}
                ({b.timezone})
              </p>
              <p>Optional human pre-call: {b.pre_call_status ?? "Not scheduled (historical booking)"}. Your demo remains active if unanswered.</p>
              {detail.state.actions.filter(a => a.intention === `pre_call:${b.id}` && a.status === "pending").map(a => <p key={a.id}>Pre-call due: {date(a.due_at, a.timezone)} ({a.timezone})</p>)}
              {b.status === "active" && b.pre_call_status === "pending" ? <div>{(["completed", "no_answer", "skipped"] as const).map(disposition => <button key={disposition} disabled={busy} onClick={() => void mutate({ kind: "pre_call_disposition", booking_id: b.id, disposition })}>{disposition.replaceAll("_", " ")}</button>)}</div> : null}
              {b.attribution ? <p>Original channel: {String(b.attribution.outreach_channel ?? "unknown")} · Angle: {String(b.attribution.angle ?? "unknown")} · Template: {String(b.attribution.template_version ?? "unknown")} · IG sender: {String(b.attribution.instagram_sender_account_id ?? "not recorded")}</p> : null}
              {b.meeting_url ? (
                <a href={b.meeting_url} target="_blank" rel="noreferrer">
                  Join Google Meet
                </a>
              ) : (
                <p>Google Meet URL pending — notifications fail closed.</p>
              )}
              <p>{b.disposition ?? "No human demo disposition recorded"}</p>
              {b.status === "active" ? (
                <div>
                  {[
                    "INTERESTED",
                    "FOLLOW_UP_NEEDED",
                    "NOT_INTERESTED",
                    "NO_SHOW",
                  ].map((d) => (
                    <button
                      key={d}
                      disabled={
                        busy || !b.start || Date.parse(b.start) > Date.now()
                      }
                      onClick={() =>
                        void mutate({
                          kind: "demo_disposition",
                          booking_id: b.id,
                          disposition: d,
                        })
                      }
                    >
                      {d.replaceAll("_", " ")}
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          <h3>Upcoming automation · dry-run only</h3>
          {detail.state.notifications.map((n) => (
            <details key={n.id}>
              <summary>
                {n.kind.replaceAll("_", " ")} · {n.status}
              </summary>
              <p>{date(n.due_at, MARKETS[detail.context.market].timezone)}</p>
              <strong>{n.subject}</strong>
              <p className="followup-copy">{n.body}</p>
              {n.reason ? <p>{n.reason}</p> : null}
            </details>
          ))}
        </>
      ) : null}
      <style jsx>{`
        .followup {
          margin: 20px 0;
          padding: 24px;
          background: #14161b;
          border: 1px solid #2a2d35;
          border-radius: 20px;
          color: #eeedf3;
        }
        .followup header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .followup small {
          color: #b7accf;
        }
        .followup h2 {
          font-size: 26px;
          margin: 8px 0 20px;
        }
        .followup h3 {
          font-size: 16px;
          margin: 24px 0 12px;
        }
        .followup p,
        .followup time {
          font-size: 13px;
          line-height: 1.6;
          color: #c0c1ce;
        }
        .followup button,
        .followup select,
        .followup input {
          background: #22252e;
          color: #f4f2fa;
          border: 1px solid #444454;
          padding: 10px;
          border-radius: 8px;
          margin: 5px;
        }
        .followup button:disabled {
          opacity: 0.45;
        }
        .followup label {
          display: block;
          margin: 8px 0;
        }
        .followup article,
        .followup details {
          padding: 14px;
          border: 1px solid #30333c;
          border-radius: 12px;
          margin: 10px 0;
        }
        .followup-columns {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }
        .followup-copy {
          white-space: pre-wrap;
        }
        .followup table {
          border-collapse: collapse;
          display: block;
          overflow: auto;
        }
        .followup td,
        .followup th {
          padding: 8px;
          text-align: left;
        }
        .followup a {
          color: #b9aaff;
        }
        @media (max-width: 850px) {
          .followup-columns {
            grid-template-columns: 1fr;
          }
          .followup {
            padding: 15px;
          }
        }
      `}</style>
    </section>
  );
}
async function readMutation(url: string, payload: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, idempotencyKey: crypto.randomUUID() }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok)
    throw new Error(
      data.code ??
        "Update could not be saved. Reload and check the timeline before retrying.",
    );
  return data.data;
}
