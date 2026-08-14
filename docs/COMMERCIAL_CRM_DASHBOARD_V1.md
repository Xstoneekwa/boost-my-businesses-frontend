# Commercial CRM Dashboard V1

## Scope

Owner-only, read-only founder cockpit at `/instagram-dashboard/commercial`.
This phase does not run Discovery, send email, send Instagram DMs, or mutate a
lead. Production is intentionally allowed to render real empty states.

## Authorization

Every page, API route, and server data loader uses
`requireCommercialCrmAccess()`:

```text
authenticated + superadmin + active commercial_crm_access grant
```

Navigation visibility is derived server-side from the same decision, but is
only a UX layer. The database read RPC is independently executable only by
`service_role`; `public`, `anon`, and `authenticated` are revoked.

## Routes

| Route | Purpose |
|---|---|
| `GET /instagram-dashboard/commercial` | Server-rendered cockpit, filters, queues, funnel, breakdowns, and paginated lead table |
| `GET /instagram-dashboard/commercial/leads/:leadId` | Server-rendered lead detail, conversion linkage, and latest 100 events |
| `GET /api/instagram-dashboard/commercial/overview` | No-store JSON read model; accepts the same bounded filters as the page |
| `GET /api/instagram-dashboard/commercial/leads/:leadId` | No-store JSON lead detail |

API query parameters: `range`, `campaign`, `country`, `city`, `vertical`,
`subsegment`, `channel`, `message_angle`, `template_version`, `priority`,
`qualification_status`, `outreach_status`, `sales_status`, `search`,
`date_from`, `date_to`, `page`, and `page_size` (maximum 100).

## Metric contract

- Time windows are lead-created cohorts (`commercial_leads.created_at`).
- Qualified includes current `qualified` and `approved` leads.
- Contacted, replied, Sales Qualified, and Demo use coherent current state.
- Paid is sourced only from `commercial_conversions`, never inferred from a
  loose message or Stripe string.
- `Paid / 100 qualified` is hidden as `Not enough data` below 20 qualified
  leads, both globally and for breakdown rows.
- Needs Sales Action remains empty until a reliable due/action field or event
  contract exists. It deliberately does not infer urgency.

## Performance

`commercial_dashboard_read_model_v1` performs aggregation in PostgreSQL and
returns one coherent JSON projection. It never transfers all raw events or all
leads to the browser. Page size is capped at 100, timeline at 100 events, and
owner queues at 8 rows each. The migration adds indexes for cohort windows and
stable updated-time pagination.

## Development fixtures

The PostgreSQL harness creates 40 deterministic synthetic leads inside a
transaction, validates metrics/funnel/breakdowns/search/pagination, and rolls
the transaction back. No fixture is persisted to production.
