# Community edits for the Berlin Christmas markets map — design

Status: draft for approval (revised 2026-10-28 for Cloudflare). Items marked **(my call)** are decisions the author of this document made without the owner having chosen them; everything else was stated by the owner.

## Intent and why

The map (https://xmas.dariuszsiedlecki.com/, hosted on GitHub Pages, data in `markets.json`) has dates and locations for ~130 markets but nothing a visitor actually wants once they are standing there: the entrance fee, what a Glühwein costs, a good fact about the place. The owner can't visit every market; visitors can. The goal is to let anyone submit that information with no account, and to let the owner approve it before it appears.

The owner also wants the market data itself moved into a database so there is a single place to edit, instead of a JSON file edited by script. Backend is Cloudflare (revised from Supabase: the owner chose Cloudflare).

## Goals

1. A visitor opens the site with no sign-in. If they allow location and are at a market, a banner says "You're at <market>" with an "Add info" button. Without location, the same Edit buttons are in every market popup.
2. Each community field has an Edit/Add button: **entrance fee, Glühwein price, fun fact, description**. The visitor types a value, optionally a short note, taps "Send for review", and sees a "Thanks, sent for review" message.
3. The owner has a private review page on the same site listing pending edits as old value → new value, with **Approve**, **Edit text** (fix a typo, then approve) and **Reject**.
4. An approved value appears on the live map without a redeploy.
5. All market data lives in a hosted database (Cloudflare D1, free plan at this traffic; no auto-pausing; Time Travel point-in-time restore is built in).
6. The site stays on GitHub Pages and stays crawlable by search engines.

## Non-goals

- Visitor accounts, logins, profiles or reputation.
- Visitors editing the basics: **name, dates, location, URL, closed days**. Those are owner-only.
- Photos or file uploads.
- Email or push notifications of new submissions in v1 (the owner opens the review page) **(my call)**.
- Translating submitted text. It is shown exactly as submitted, in whatever language **(my call)**.
- A full admin UI for editing market basics in v1: the owner (or Claude, on request) edits them in the D1 dashboard or by script **(my call; flag if you want this page in v1)**.

## Anti-goals (would make this a failure even if it technically works)

- Any visitor-submitted text becoming visible before the owner approves it.
- The map breaking or going blank if the database is down or slow.
- Submitted text being able to inject HTML/script into the page (all submitted text rendered as plain text).
- Search engines losing the static market list in `index.html`.

## Constraints

- Hosting stays GitHub Pages: static files only, no server of ours.
- Existing app is a single `index.html` with Leaflet; it already loads `markets.json` with `fetch` and already asks for the browser's geolocation (distance panel) — location detection reuses that.
- `scripts/generate_seo_content.py` reads `markets.json` and rewrites the SEO blocks in `index.html`. It must keep working unchanged, so the export (below) must produce the same `markets.json` shape as today.
- Expected traffic is low; the owner doesn't expect many submissions. Spam protection stays light.

## Design

### Architecture

```
visitor browser ──(read)──► markets.json (static, on Pages)  ─┐
       │                                                      ├─► map
       ├──(read approved info, live)──► Worker /api/info ─────┘
       └──(submit edit)──► Worker /api/suggest ──► D1 suggestions (pending)

owner ──► Worker /admin/ (behind Cloudflare Access, email one-time PIN) ──► approve/edit/reject
                                                            │
nightly GitHub Action: Worker /api/export ──► markets.json ──► run SEO script ──► commit ──► Pages deploys
```

The map loads `markets.json` first (fast, works offline from the database), then overlays community info fetched live from the Worker. If that fetch fails, it shows the info baked into `markets.json` at the last export; if there is none, the fields simply don't appear.

### Data model (SQLite, in Cloudflare D1)

- `markets` — one row per market, mirroring today's `markets.json` fields: `name`, `name_de`, `name_en`, `loc`, `url`, `lat`, `lng`, `start`, `end`, `dates` (date[]), `days_of_week` (int[]), `closed` (date[]), `special_open` (date[]), `tbc` (bool), `type`. Owner-writable only. Publicly readable.
- `market_info` — approved community values: `market_id`, `field` (one of `entrance`, `gluehwein_price`, `fun_fact`, `description`), `value` (text), `approved_at`, `suggestion_id`. One current value per (market, field); approving replaces the previous value. Publicly readable.
- `suggestions` — `id`, `market_id`, `field`, `value`, `note`, `status` (`pending` | `approved` | `rejected`), `created_at`, `reviewed_at`, `distance_m` (nullable: client-reported distance to the market, used only for the "far from market" flag). Anonymous visitors can only insert, and only as `pending`; they can never read the table. Owner reads and updates all.
- Field list is a CHECK constraint so a field can be added later by migration. Arrays (`dates`, `days_of_week`, `closed`, `special_open`) are stored as JSON text.

### Access rules

D1 is not reachable from browsers; only the Worker touches it, so access is enforced in Worker routes.

- Public routes (no auth): `GET /api/info` (approved `market_info`), `POST /api/suggest` (insert `pending` suggestion). Nothing public reads `suggestions`.
- Owner routes (`/admin/*`, `/api/admin/*`): protected by a Cloudflare Access policy allowing only the owner's email (one-time PIN). The Worker also verifies the Access JWT (`Cf-Access-Jwt-Assertion`) on every owner route, so a misconfigured Access policy cannot expose them.
- Export route `GET /api/export`: requires a bearer token held as a GitHub Actions secret; returns markets plus approved info.

### Submission path

The Worker's `POST /api/suggest` receives the suggestion, validates it (known market, known field, value length cap, note length cap, non-empty), rate-limits per hashed IP (e.g. ~10 per hour, via a Workers rate limiting binding), and inserts a `pending` row. Raw coordinates are never sent or stored; the browser computes its distance to the market and sends only `distance_m` **(my call)**. A hidden honeypot field in the form blocks naive bots. CORS allows only the site origin.

### Visitor UI (in `index.html`)

- Location banner "You're at <market> — Add info" when the browser's position is within ~300 m of a market **(my call on the radius)**. Dismissible; never shown without permission.
- Market popup gains a "Community info" section with the four fields, each with ✎ Edit / ✎ Add. Empty fields show a prompt ("No price yet — know it?").
- Edit form: one field, optional note, "Send for review" / Cancel. After submit: confirmation toast. No account language anywhere.
- All community text inserted with `textContent` (never as HTML).
- Mockup was reviewed and approved by the owner in conversation ("Looks amazing").

### Owner review page (`/admin/`)

- Static page served by the Worker (static assets), behind Cloudflare Access. Anyone else gets the Access login wall and no data (enforced by Access plus the JWT check in the Worker, not by hiding the page).
- Tabs Pending / Approved / Rejected. Each pending card: market, field, old → new, age, a "far from market" badge when `distance_m` is large or absent, and Approve / Edit text / Reject.
- Approve writes/replaces the `market_info` row and marks the suggestion approved. The change is visible on the live map immediately.

### Migration

A one-off script imports the current 131 markets from `markets.json` into `markets`, including `tbc`, `dates`, `closed`, `special_open`. After import, `markets.json` stops being hand-edited and becomes a generated snapshot.

### Export and SEO

A scheduled GitHub Action (nightly, plus manual run) calls `/api/export` with the export token, writes `markets.json` in the existing shape (community info added under a new `info` key per market that the app and SEO script ignore if absent), runs `scripts/generate_seo_content.py`, and commits only if something changed. The existing Pages workflow then deploys. The Action's daily activity also means the database is never idle.

## What the builder decides

- Worker code structure (Hono vs plain fetch handler), as long as rate limiting and the validation above hold.
- Exact radius, rate-limit numbers, length caps, and styling (reuse the app's existing look).
- How the app merges live `market_info` over the snapshot, and the exact key name for community info in `markets.json`.
- Whether the `/admin/` page is plain JS or a tiny framework; it must stay a static page.
- Where secrets live (GitHub Actions secret for the export token; Worker secrets via wrangler). The browser needs no key.

## Open questions for the owner

1. Do you want a way to edit market **basics** (dates, closed days) from the admin page in v1, or is the D1 dashboard / asking Claude enough for now?
2. Is `dariuszsiedlecki.com` on Cloudflare DNS? If yes, API and admin live at e.g. `xmas-api.dariuszsiedlecki.com`; if not, a free `*.workers.dev` address (works fine, Access included). My default: workers.dev, switchable later.
3. After a field is approved, should a later visitor be able to propose a replacement (my assumption: yes, it goes through review again)?
