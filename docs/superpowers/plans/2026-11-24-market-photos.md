# Market photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a photo banner at the top of each market's detail sheet, with a placeholder until a photo exists, and a local script to upload photos to R2.

**Architecture:** Photos live in an R2 bucket bound to the Worker as `PHOTOS` and are served from `/img/<key>`. D1 `markets` gets `image`, `image_credit`, `image_source` columns, exposed by `/api/markets`. The front end renders a banner from those fields. `scripts/upload_photo.py` drives Wrangler to upload to R2 and update D1.

**Tech Stack:** Cloudflare Worker, D1, R2, vanilla JS in `index.html`, Python 3 stdlib, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-24-market-photos-design.md`

## Global Constraints

- Python scripts: Python 3 stdlib only. Front end: no dependencies, no build step.
- Photo types: JPEG or WebP only; max 2 MB; key regex `^[a-z0-9-]+\.(jpg|webp)$`.
- Credit and source are both required when uploading. `image_source` must start with `https://` or `http://`.
- All market text is escaped before it goes into HTML (`esc()` in `index.html`).
- Cache: `/img/*` is `public, max-age=86400`. Keys carry a content hash (`<slug>-<hash8>.<ext>`) so a replaced photo gets a new URL.
- Schema SQL goes into `worker/schema.sql` first. The user has approved creating bucket `berlin-xmas-photos` and adding the three columns to the remote `markets` table.
- The nightly bot commits to `main`: `git pull --rebase` before each push. Commit only when each commit leaves the site working; one logical change per commit, imperative messages, ending with the Co-Authored-By line.

## Review Focus

- Market with no image fields (all current markets): placeholder shown, no broken `<img>`.
- Market with an image whose file is missing from R2 (404): the banner falls back to the placeholder.
- `image_credit` containing `<script>` or quotes: rendered as text only.
- `image_source` that is not an http(s) URL (e.g. `javascript:`): no link is rendered, credit shown as plain text.
- `/img/` request with path traversal or odd characters (`../x.jpg`, `a/b.jpg`, `X.JPG`): 404, never reads R2.

---

### Task 1: Banner and placeholder in the sheet

**Files:**
- Modify: `index.html` (CSS near `.marker-popup-header` ~line 3285; `createMarker()` ~line 4028)

**Interfaces:**
- Consumes: `market.image`, `market.image_credit`, `market.image_source` (optional strings from `/api/markets`, added in Task 2).
- Produces: `photoBanner(market) -> string` HTML, called from the `popup` template.

- [ ] **Step 1: Add `photoBanner(market)` next to `createMarker`.** Returns a `<div class="market-photo">` holding either `<img src="/img/${esc(image)}" alt="${esc(market.name)}" loading="lazy" decoding="async">` plus, when `image_credit` is set, a `<div class="market-photo-credit">` (a link to `image_source` only if it matches `^https?://`, otherwise plain text; all values through `esc`), or, with no image, an inline-SVG placeholder (`aria-hidden`, brand-coloured gradient background with a small tree/star icon). The `<img>` has an `onerror` handler that removes itself and adds class `no-photo` to the wrapper so the placeholder shows (write it as an addEventListener after the popup element is built, not an inline attribute).
- [ ] **Step 2: CSS.** `.market-photo` is `aspect-ratio: 16/9; max-height: 28dvh; width: 100%; object-fit: cover` and sits above `.marker-popup-header`; the credit is a small caption pinned bottom-left with a dark translucent background. Keep `.sheet-close` and the drag handle readable on top of the banner (they are already white; give the banner a top gradient scrim).
- [ ] **Step 3: Insert `${photoBanner(market)}` as the first child of `.marker-popup`.**
- [ ] **Step 4: Verify in a browser.** Run `cd worker && npx wrangler@4 dev --local-upstream localhost:8787`, open a market at mobile (375 px) and desktop width. Expected: placeholder banner above the red header, name, dates and the share/edit controls all still reachable by scrolling, no console errors, close button and handle visible. Then in the console set `market.image = 'x.jpg'` via a temporary override and confirm a missing file falls back to the placeholder, and that `image_credit = '<b>x</b>'` shows literal text.
- [ ] **Step 5: Commit** "Add a photo banner with a placeholder to the market sheet".

### Task 2: Schema, R2 binding, `/img/` route and API fields

**Files:**
- Create: `worker/src/photos.js`, `worker/src/photos.test.js`
- Modify: `worker/schema.sql`, `worker/wrangler.jsonc`, `worker/src/index.js` (`marketRowToJson` ~line 96, router ~line 315)

**Interfaces:**
- Produces: `isPhotoKey(key: string) -> boolean` and `photoContentType(key: string) -> 'image/jpeg' | 'image/webp'` in `photos.js`; `GET /img/<key>`; `/api/markets` items gain optional `image`, `image_credit`, `image_source`.

- [ ] **Step 1: Write failing tests** in `photos.test.js`: `isPhotoKey('weihnachtsmarkt-am-gendarmenmarkt-1a2b3c4d.jpg')` is true; `.webp` is true; each of `'../x.jpg'`, `'a/b.jpg'`, `'X.jpg'`, `'x.png'`, `'x.jpg/'`, `''`, `'.jpg'` is false. `photoContentType('a.jpg') === 'image/jpeg'`, `photoContentType('a.webp') === 'image/webp'`.
- [ ] **Step 2: Run** `cd worker && node --test src/photos.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `photos.js`** using the key regex from Global Constraints. Run tests; expected PASS.
- [ ] **Step 4: Schema.** Append to `worker/schema.sql` a comment and `ALTER TABLE markets ADD COLUMN image TEXT;` (same for `image_credit`, `image_source`), noting these were applied separately to existing databases because SQLite has no `ADD COLUMN IF NOT EXISTS`. Also update `CREATE TABLE markets` so fresh databases get the columns.
- [ ] **Step 5: Create the bucket and apply the schema.** `cd worker && npx wrangler@4 r2 bucket create berlin-xmas-photos`, then apply the three `ALTER TABLE` statements with `npx wrangler@4 d1 execute berlin-xmas-markets --remote --command "..."` and the same to `--local` (after `schema.sql`/`seed.sql` if the local DB is not yet set up). Expected: success; `SELECT image FROM markets LIMIT 1` returns null. (Approved by the user; non-destructive.)
- [ ] **Step 6: Binding.** Add `"r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "berlin-xmas-photos" }]` to `wrangler.jsonc`.
- [ ] **Step 7: Route and API.** In `index.js` handle `GET` for `/img/<key>` before the asset fallthrough: if `!isPhotoKey(key)` return 404; `env.PHOTOS.get(key)`; 404 if null; else respond with the body, `content-type` from `photoContentType`, `cache-control: public, max-age=86400`, and the object's `httpEtag` as `etag`. In `marketRowToJson` copy `image`, `image_credit`, `image_source` through (null values are already stripped).
- [ ] **Step 8: Verify locally.** `node --test src/*.test.js` passes. With `wrangler dev`, put a small JPEG with `npx wrangler@4 r2 object put berlin-xmas-photos/test-1a2b3c4d.jpg --file <jpg> --local`, then `curl -sI localhost:8787/img/test-1a2b3c4d.jpg` shows 200, `image/jpeg`, the cache header; `curl -s -o /dev/null -w '%{http_code}' 'localhost:8787/img/..%2Fx.jpg'` and `/img/X.jpg` give 404; `curl localhost:8787/api/markets | head -c 400` is unchanged for markets without an image.
- [ ] **Step 9: Commit** "Serve market photos from R2 and expose image fields in the API". Push (`git pull --rebase` first), then check the Deploy run with `gh run list --limit 3` and `gh run watch`.

### Task 3: Upload script and docs

**Files:**
- Create: `scripts/upload_photo.py`, `scripts/test_upload_photo.py`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `markets_api.fetch_markets() -> list[dict]`.
- Produces: `photo_key(market_name: str, data: bytes, ext: str) -> str` (`<slug>-<first 8 hex of sha256(data)>.<ext>`; slug rules identical to `marketSlug` in `worker/src/validate.js`: `ß`→`ss`, NFKD strip combining marks, lowercase, non-alphanumerics to `-`, trim `-`); `detect_type(data: bytes) -> 'jpg' | 'webp' | None` (by magic bytes: `FF D8 FF`, `RIFF....WEBP`); CLI `upload_photo.py "<market name>" <file> --credit TEXT --source URL` and `upload_photo.py "<market name>" --remove`.

- [ ] **Step 1: Write failing tests** with `unittest`: `photo_key('Weihnachtsmarkt am Gendarmenmarkt', b'abc', 'jpg')` starts with `weihnachtsmarkt-am-gendarmenmarkt-` and ends with `-` + the first 8 hex chars of `sha256(b'abc')` + `.jpg`; a name with `ß`/umlauts slugifies like the JS version (`'Märkte Straße'` → `markte-strasse-…`); `detect_type` returns `'jpg'` for `b'\xff\xd8\xff\xe0...'`, `'webp'` for `b'RIFF\x00\x00\x00\x00WEBPVP8 '`, `None` for PNG bytes and empty bytes.
- [ ] **Step 2: Run** `python3 -m unittest scripts/test_upload_photo.py`. Expected: FAIL.
- [ ] **Step 3: Implement the pure functions.** Run tests; expected PASS.
- [ ] **Step 4: Implement the CLI.** Steps in order, each failure exits non-zero with a clear message before anything is changed: find the market by exact name in `fetch_markets()` (on no match print the closest names via `difflib.get_close_matches`); read the file; reject if `detect_type` is None or size > 2 MB; require `--credit` and `--source` (source must match `^https?://`); upload with `npx wrangler@4 r2 object put berlin-xmas-photos/<key> --file <file> --content-type <type> --remote` run from `worker/`; update D1 with `npx wrangler@4 d1 execute berlin-xmas-markets --remote --command "UPDATE markets SET image=?, ..."`. Because `--command` has no parameter binding, write a temporary SQL file using a `sql_quote()` helper that doubles single quotes, and pass `--file`. `--remove` sets all three columns to NULL and leaves the R2 object (keys are content-hashed, cleanup is manual). Print the final URL `https://xmas.dariuszsiedlecki.com/img/<key>`.
- [ ] **Step 5: Test the quoting.** Add a unit test: `sql_quote("O'Brien <b>")` equals `'O''Brien <b>'` including the surrounding quotes.
- [ ] **Step 6: End-to-end check with one real market** (use a small JPEG chosen by the user, or a generated 800 px test image and `--remove` afterwards): run the script, then `curl -sI <printed url>` returns 200 and `curl -s .../api/markets | grep image_credit` shows the fields; open the market in a browser at mobile and desktop width and confirm the photo and credit line render. Then run `--remove` on the test market and confirm the placeholder returns.
- [ ] **Step 7: Docs.** In `CLAUDE.md` add a short "Market photos" section: the bucket, `/img/` route, the three columns, the upload command, 800 px wide JPEG/WebP under 500 KB recommended (2 MB hard limit), and that credit plus source are mandatory and a person must check each photo's licence. Add `scripts/upload_photo.py` to the Layout list.
- [ ] **Step 8: Commit** "Add a script to upload market photos to R2". Push and check the Deploy run.
