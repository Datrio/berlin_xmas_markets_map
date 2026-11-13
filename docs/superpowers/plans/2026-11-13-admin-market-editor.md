# Admin market editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner view, edit, add and delete every market in D1 from `/admin`, alongside the existing suggestion review.

**Architecture:** Pure validation lives in `worker/src/validate.js` (Node-testable). New `/api/admin/markets*` routes in `worker/src/index.js` use it and write to D1. `worker/src/admin.html` gets a Markets tab (inline-editable table, expandable row form, add, typed-name delete) next to the existing Suggestions tab.

**Tech Stack:** Cloudflare Worker, D1, vanilla JS, `node --test` (Node 22, no dependencies).

**Spec:** `docs/superpowers/specs/2026-11-13-admin-market-editor-design.md`

## Global Constraints

- No new dependencies, no build step; vanilla JS matching the surrounding code's style and comment density.
- Schema unchanged. JSON columns stored as `JSON.stringify(array)` or NULL when empty.
- All admin routes stay behind `verifyAccess`; user text rendered via `textContent`/`value`, never `innerHTML`.
- Dates are real calendar dates `YYYY-MM-DD`; `days_of_week` unique integers 0–6 (0 = Sunday); lat 52.3–52.7, lng 13.0–13.8; info values ≤ 500 chars (`MAX_VALUE`); name non-empty, ≤ 120 chars.
- Errors are `400 {error, field}`; duplicate name is `409`.
- Commit atomically, only when the owner asks (CLAUDE.md): the commit steps below are to be run once they have said so. Run `git pull --rebase` before any push. Never touch the remote database; test against local D1 only.

## Review Focus

- Two names that differ only in case, accents or punctuation produce the same `/market/<slug>`: the second must be rejected with 409 (SQLite `UNIQUE` is case-sensitive and would allow it).
- A market created without lat/lng would break the map; create requires both, and PATCH cannot null them (stricter than the spec's "others optional", **my call**, to honour the anti-goal of bad data reaching the map).
- `2026-02-30` and `2026-13-01` look valid to a regex but must be rejected.
- Empty or unknown-field PATCH body, and PATCH/DELETE of a nonexistent id, return 400/404 rather than a silent 200.
- A name containing `<script>` or quotes renders as plain text in the table and the delete dialog.
- Deleting a market with info and suggestions removes both in one batch; a failure leaves everything intact.

## File Structure

- Create `worker/src/validate.js`: pure functions, no imports. Create `worker/src/validate.test.js`.
- Create `worker/src/access.js`: `isDevAdmin`. Create `worker/src/access.test.js`.
- Modify `worker/src/index.js`: bypass in `verifyAccess` call site, market admin routes in `adminApi`.
- Modify `worker/src/admin.html`: tabs and Markets UI.
- Modify `CLAUDE.md`: Layout/admin notes (Task 6).

### Task 1: Validation rules

**Files:**
- Create: `worker/src/validate.js`
- Test: `worker/src/validate.test.js`

**Interfaces:**
- Produces: `validateMarket(input: object, {partial: boolean}) -> {ok: true, value: object} | {ok: false, error: string, field: string}`. `value` is keyed by column name (`days_of_week`, `special_open` etc.), arrays already `JSON.stringify`ed or `null`, `tbc` as 0/1, lat/lng numbers. With `partial: false` (create) `name`, `lat`, `lng` are required; with `partial: true` only present keys are checked and an empty object is an error. Unknown keys are an error.
- Produces: `marketSlug(name: string) -> string` (moved verbatim from `index.js`, which then imports it).
- Produces: `validateInfo(field: string, value: string) -> {ok: true, value: string|null} | {ok: false, error: string}`; `null` means delete (empty after trim). Field must be one of the four info fields.

- [ ] **Step 1: Write failing tests** in `validate.test.js` (`node:test` + `node:assert/strict`), one test per rule, each with the exact values: valid create `{name:'X', lat:52.5, lng:13.4}` ok; missing lat on create fails with `field:'lat'`; `lat:53` and `lng:12.9` fail; name `'  '` and 121 chars fail; `start:'2026-02-30'` fails, `'2026-12-01'` passes; `start > end` fails with `field:'end'`; `dates:['2026-11-27','nope']` fails; `days_of_week:[1,1]` and `[7]` fail, `[3,4,5]` stored as `'[3,4,5]'`; empty `closed:[]` stored as `null`; `url:'javascript:alert(1)'` fails, `''` becomes `null`; `tbc:true` becomes `1`; `{}` partial fails; `{bogus:1}` fails; `lat:null` partial fails; `marketSlug('Märkte  ß!')` equals `'markte-ss'`; `validateInfo('entrance','')` gives `value:null`, a 501-char value fails, `'fun'` unknown field fails.
- [ ] **Step 2: Run** `cd worker && node --test src/validate.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `validate.js` per the interfaces. Real-date check: build `new Date(s + 'T00:00:00Z')` and compare `toISOString().slice(0,10)` to `s`. Coerce numeric strings for lat/lng; reject NaN.
- [ ] **Step 4: Run** the same command. Expected: all PASS.
- [ ] **Step 5: Commit** `git add worker/src/validate.js worker/src/validate.test.js && git commit -m "Add validation rules for editing markets"`.

### Task 2: Local admin bypass

**Files:**
- Create: `worker/src/access.js`, `worker/src/access.test.js`
- Modify: `worker/src/index.js` (the admin guard at `index.js:203-204`), `worker/.dev.vars` (add `DEV_ADMIN=1`; gitignored)

**Interfaces:**
- Produces: `isDevAdmin(request: Request, env: object) -> boolean`: true only when `env.DEV_ADMIN === '1'` and `new URL(request.url).hostname === 'localhost'`.

- [ ] **Step 1: Write failing tests**: true for `DEV_ADMIN:'1'` on `http://localhost:8787/admin`; false for `DEV_ADMIN:'1'` on `https://xmas.dariuszsiedlecki.com/admin`; false for `{}` on localhost; false for `DEV_ADMIN:'true'`; false for host `localhost.evil.com`.
- [ ] **Step 2: Run** `node --test src/access.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `isDevAdmin`, then change the guard to `if (!isDevAdmin(request, env) && !(await verifyAccess(request, env)))`. Append `DEV_ADMIN=1` to `.dev.vars`.
- [ ] **Step 4: Run** the test (PASS), then start `npx wrangler@4 dev` and `curl -i localhost:8787/api/admin/suggestions` expecting 200; with `DEV_ADMIN` removed from `.dev.vars` expecting 403 (restore afterwards).
- [ ] **Step 5: Commit** `git add worker/src/access.js worker/src/access.test.js worker/src/index.js && git commit -m "Allow admin routes on localhost when DEV_ADMIN is set"`.

### Task 3: Market admin API

**Files:**
- Modify: `worker/src/index.js` (`adminApi`; replace local `marketSlug` with import from `./validate.js`)

**Interfaces:**
- Consumes: `validateMarket`, `validateInfo`, `marketSlug` from Task 1; `withCurrency` already in `index.js`.
- Produces (JSON, all under `/api/admin/`): `GET markets` returns an array of raw DB rows (JSON columns parsed to arrays, `tbc` boolean) each with `info: {entrance?, gluehwein_price?, fun_fact?, description?}` and `pending: number`; `POST markets` returns `201 {id}`; `PATCH markets/:id` returns the updated row in the same shape; `DELETE markets/:id` returns `{ok:true, removed:{info:n, suggestions:n}}`; `PUT markets/:id/info/:field` with body `{value}` returns `{ok:true, value}` (`value` null when deleted). A `GET markets/:id/delete-preview` is not needed: the UI takes counts from the `GET markets` row (`info` keys and `pending`; total suggestion count is added as `suggestions: number`).

- [ ] **Step 1: Prepare local DB**: `cd worker && npx wrangler@4 d1 execute berlin-xmas-markets --local --file=schema.sql && npx wrangler@4 d1 execute berlin-xmas-markets --local --file=seed.sql`; start `npx wrangler@4 dev`.
- [ ] **Step 2: Run these `curl` calls before implementing, to see them fail (404), and again after; expected results in brackets: `POST markets {"name":"Test A","lat":52.5,"lng":13.4}` [201]; same again [409]; `{"name":"test a","lat":52.5,"lng":13.4}` [409 via slug]; `PATCH markets/<id> {"start":"2026-02-30"}` [400 field start]; `PATCH {"end":"2026-12-01","start":"2026-11-01"}` [200]; `PATCH {}` [400]; `PUT markets/<id>/info/entrance {"value":"3"}` [200 value `3 EUR`]; `GET markets` contains the test market with that info; `DELETE markets/<id>` [200 removed.info 1]; `DELETE` again [404]; `GET /api/markets` still returns 130 markets.
- [ ] **Step 3: Implement the routes** in `adminApi`. PATCH uses `validateMarket(body,{partial:true})`, builds `UPDATE markets SET <cols> WHERE id=?` from the returned keys only (column names come from the validator's fixed allow-list, never from the request). Name uniqueness: before insert/rename, load all names and compare `marketSlug` excluding the current id; return 409 `{error:'A market with that name or URL already exists', field:'name'}`. DELETE uses one `env.DB.batch` deleting from `market_info`, `suggestions`, `markets` in that order. PUT info uses `validateInfo`, then `withCurrency`, then the existing upsert (with `suggestion_id` NULL), or DELETE from `market_info` when the value is null.
- [ ] **Step 4: Re-run the Step 2 calls**, verify every bracketed result, and run `node --test src/`. Expected: all PASS.
- [ ] **Step 5: Commit** `git add worker/src/index.js && git commit -m "Add admin API to list, edit, add and delete markets"`.

### Task 4: Markets table with inline editing

**Files:**
- Modify: `worker/src/admin.html`

**Interfaces:**
- Consumes: `GET markets`, `PATCH markets/:id` from Task 3.
- Produces: tab switcher (`#tab-markets`, `#tab-suggestions`) with the existing suggestions code moved under the Suggestions tab unchanged in behaviour; JS functions `loadMarkets()`, `saveField(row, field, value)` and `renderRow(market)` for Task 5 to extend.

- [ ] **Step 1: Implement the tabs and table.** Markets tab is the default. Columns: name, name_de, name_en, loc, url, type, lat, lng, start, end, tbc (checkbox), plus an expand button (disabled until Task 5). Sticky header, search box filtering on name/loc, click-to-sort headers. Each cell is a labelled `<input>` (`aria-label` = column + market name); on change it calls `PATCH`, marks the cell dirty while saving, shows a per-row status (saving / saved / the API's `error`), and on error leaves the value and highlights the cell. Escape reverts to the last saved value. Table scrolls horizontally on narrow screens. Keep the red `#c41e3a` accent and the dark-mode rules.
- [ ] **Step 2: Verify in the browser** (`localhost:8787/admin`, desktop and 375 px width, console open): table shows 130 rows; edit a `loc`, reload, value persisted; enter `start` `2026-02-30` and see the error with the value kept; Escape reverts; a name set to `<b>x</b>` appears as text; no console errors; Suggestions tab still lists, approves and rejects as before. Revert any test edits afterwards.
- [ ] **Step 3: Commit** `git add worker/src/admin.html && git commit -m "Add markets table with inline editing to the admin page"`.

### Task 5: Expand form, add and delete

**Files:**
- Modify: `worker/src/admin.html`

**Interfaces:**
- Consumes: `POST`, `PATCH`, `DELETE markets*` and `PUT markets/:id/info/:field` from Task 3; `renderRow` and `saveField` from Task 4.

- [ ] **Step 1: Implement the expand row.** Toggle shows a form below the row: add/remove lists (`<input type="date">`) for `dates`, `closed`, `special_open`; seven Sun–Sat checkboxes (values 0–6) for `days_of_week`; four labelled textareas for the info fields, each with its own Save (PUT; empty saves delete the value). List and checkbox changes save through `saveField` with the full array. When the name input differs from the saved name, show "Renaming changes this market's public URL (/market/…)".
- [ ] **Step 2: Implement Add market.** A "+ Add market" button inserts a blank row at the top with name, lat, lng required; it POSTs when the owner presses Save on that row and shows API errors inline; on success the row becomes a normal row.
- [ ] **Step 3: Implement Delete.** A Delete button in the expanded form opens a `<dialog>` stating "This removes <name>, N community info values and M suggestions. This cannot be undone." with a text input; the confirm button stays disabled until the input equals the market name exactly; then `DELETE` and remove the row.
- [ ] **Step 4: Verify in the browser** (desktop and 375 px, console open): add a market with a taken name, see 409 message; add a valid one; give it dates, days and an entrance fee, reload, all persisted; `GET /api/markets` shows `dates` and `daysOfWeek` and `info`; delete it with a wrong name (button disabled) and the right name (row gone, `curl localhost:8787/api/markets` back to 130); keyboard: Tab through a row, open and close the dialog with Escape; no console errors.
- [ ] **Step 5: Commit** `git add worker/src/admin.html && git commit -m "Add row editor, add-market and confirmed delete to the admin page"`.

### Task 6: Docs and final check

**Files:**
- Modify: `CLAUDE.md` (Layout: describe the admin routes and `validate.js`, `access.js`, the `DEV_ADMIN` local bypass, `node --test src/` as the way to run tests; "Test before you ship": mention the tests exist)

- [ ] **Step 1: Update `CLAUDE.md`** with those lines, matching its existing terse style.
- [ ] **Step 2: Final verification:** `cd worker && node --test src/` all PASS; `git status` shows no `.dev.vars` or `.wrangler`; `npx wrangler@4 deploy --dry-run` succeeds.
- [ ] **Step 3: Commit** `git add CLAUDE.md && git commit -m "Document the admin market editor and local test workflow"`.
- [ ] **Step 4: Push (only when the owner says):** `git pull --rebase && git push`, then `gh run list --limit 3` and `gh run watch` until "Deploy to Cloudflare" succeeds; open the live `/admin` behind Access and check one edit end to end, reverting it afterwards.
