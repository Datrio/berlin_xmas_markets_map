# Admin market editor — design

Status: draft for approval. Items marked **(my call)** were decided by the author of this document, not stated by the owner.

## Intent and why

`/admin` today only reviews community suggestions. Changing a market's dates, coordinates or name means asking Claude or running SQL against D1. The owner wants to see all markets in a table and edit every property themselves, add new markets and delete old ones (with confirmation), without help.

## Goals

1. `/admin` shows every market in a table (search, sort by column).
2. Simple fields are editable inline in the table: name, name_de, name_en, loc, url, type, lat, lng, start, end, tbc.
3. An expand control on each row opens a form for the awkward fields: `dates`, `days_of_week`, `closed`, `special_open` (proper widgets, not raw JSON), plus the four community-info texts (`entrance`, `gluehwein_price`, `fun_fact`, `description`).
4. "+ Add market" creates a market. "Delete" removes one after the owner types the market's name to confirm.
5. The existing suggestion review stays, as a second tab.
6. Saved edits show on the public map without a deploy (API caches ~60 s; the nightly job refreshes the SEO block).

## Non-goals

- Bulk import/export, undo history, audit log. D1 Time Travel covers disasters **(my call)**.
- Editing suggestions' history, or changes to the public map or `/api/suggest`.
- Multi-user concurrency handling. One owner; last write wins **(my call)**.

## Anti-goals

- Bad data reaching the public map (a malformed date or JSON column breaking `/api/markets` for everyone).
- Admin routes reachable without the Cloudflare Access check (they stay behind `verifyAccess`).
- Deleting a market by a single misclick.

## Constraints

- Everything stays in `worker/src/index.js` and `worker/src/admin.html`; no new dependencies, no build step, vanilla JS, matching the existing code style.
- Schema is unchanged. `markets` columns: name (unique), name_de, name_en, loc, url, type, lat, lng, start, end, dates, days_of_week, closed, special_open (JSON text), tbc.
- Live data shapes (130 markets, checked 2026-11-13): dates/closed/special_open are arrays of `YYYY-MM-DD`; `days_of_week` is an array of 0–6 with 0 = Sunday; start/end are `YYYY-MM-DD`; `type` is null for all but one; lat 52.39–52.64, lng 13.16–13.62.
- `name` is unique and drives the `/market/<slug>` URL and sitemap. Community info and suggestions reference `market_id`, so renaming loses no data.

## Approaches considered

- **A. Pure inline spreadsheet**, JSON columns as raw text. Fastest for simple fixes, but hand-typed JSON is error-prone.
- **B. Read-only list plus edit form per market.** Hard to enter bad data, but two clicks for a one-field fix.
- **C. Hybrid (chosen by the owner):** inline cells for simple fields, expandable row form for JSON and info fields.

## Design

### API (all under `/api/admin/`, behind `verifyAccess`)

| Route | Purpose |
|---|---|
| `GET markets` | all rows, plus each market's four info values and its pending suggestion count |
| `PATCH markets/:id` | partial update of any editable field (body: object of changed fields) |
| `POST markets` | create (name required, others optional) |
| `DELETE markets/:id` | delete market, its `market_info` and `suggestions` in one `DB.batch` |
| `PUT markets/:id/info/:field` | set a community-info value; empty string deletes it |

Server-side validation, shared by PATCH and POST, returns `400 {error, field}`:
- name: non-empty, ≤ 120 chars, unique (409 on conflict).
- url: empty, or `http(s)://`.
- lat/lng: finite numbers inside a Berlin box, 52.3–52.7 / 13.0–13.8 **(my call)**.
- start/end/dates/closed/special_open entries: real calendar dates in `YYYY-MM-DD`; start ≤ end when both set.
- days_of_week: unique integers 0–6.
- tbc: boolean. Info values: ≤ 500 chars (existing `MAX_VALUE`), price fields go through `withCurrency`.
- JSON columns are stored as `JSON.stringify(array)` or NULL when empty, matching what `marketRowToJson` reads.

### UI (`admin.html`)

- Tabs: **Markets** (default) and **Suggestions** (the current page, unchanged in behaviour).
- Markets table: sticky header, search box filtering by name/loc, click a header to sort. Cells are inputs; a changed cell is marked dirty and saves on blur/Enter with a small per-row status (saving / saved / error message from the API). Escape reverts the cell. Mobile: table scrolls horizontally.
- Expand row: date lists with add/remove (native `<input type="date">`), Sun–Sat checkboxes, four info textareas with their own Save. A rename shows a note that the market's public URL will change.
- Add market: a blank row at the top; saves on first valid name.
- Delete: dialog stating what is removed (market, N info values, N suggestions), requiring the exact market name typed, then DELETE.
- All text rendered with `textContent`/`value`, never `innerHTML`. Keyboard-operable, labelled controls.

### Testing

No test suite exists. Validation moves into pure functions in a new `worker/src/validate.js` and gets Node-based tests (`node --test`, no dependency) for the rules above **(my call)**. API routes are exercised with `curl` against `wrangler dev` and a local D1; the UI is checked in a browser at mobile and desktop widths with the console open. Local `wrangler dev` has no Access JWT, so `verifyAccess` skips the JWT check only when `env.DEV_ADMIN === '1'` and the request host is `localhost`. The var is set only in the gitignored `worker/.dev.vars`, never in `wrangler.jsonc`, so production is unchanged; a test confirms the check still fails closed without it. Approved by the owner, who will not share a real Access token.

## Left to the builder

Exact column widths and styling (follow the existing red `#c41e3a` accent and dark-mode support), whether the add-row is a row or a dialog, and the wording of error messages.
