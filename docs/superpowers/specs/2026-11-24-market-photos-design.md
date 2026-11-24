# Market photos

## Intent
The market detail sheet has no picture. Add a banner photo at the top. Photos will later be sourced from the official market websites and loaded with a local script.

## Goals
- A banner at the top of the sheet: the photo if the market has one, otherwise a placeholder.
- Photos stored in R2 and served by the Worker, so they stay out of git and out of the site deploy.
- A script (`scripts/upload_photo.py`) that resizes nothing itself but validates, uploads to R2 and records the photo in D1.
- Every photo carries a credit and a source URL, shown on the banner.

## Non-goals
- No upload UI in the admin page (possible later).
- No automatic scraping of official sites. A person picks each photo and checks its licence.
- No hotlinking of third-party images.

## Constraints
- D1 is the source of truth. `/admin/*` is behind Cloudflare Access, so the script talks to Cloudflare with Wrangler (`r2 object put --remote`, `d1 execute --remote`), not the admin API.
- Schema change goes into `worker/schema.sql` first. Adding columns to a populated remote table is non-destructive but is still applied only after the user says go.
- Photos should be about 800 px wide JPEG/WebP, under 500 KB. The script rejects other types and files over 2 MB.
- Python 3 stdlib only.

## Approaches considered
1. **R2 + Worker route + script (chosen).** One new resource, no deploy per photo.
2. Photos committed to the repo: no new infrastructure, but every photo needs a deploy and the repo grows.
3. Hotlinking: breaks when sites change, licensing risk.

## Design
- **R2:** bucket `berlin-xmas-photos`, bound as `PHOTOS` in `worker/wrangler.jsonc`.
- **D1:** new nullable columns on `markets`: `image` (object key, e.g. `<slug>-<hash8>.jpg`, where `hash8` is the first 8 hex characters of the file's SHA-256, so a replaced photo gets a new URL despite the day-long cache), `image_credit`, `image_source`.
- **Worker:**
  - `GET /img/<key>` streams the object from R2 with `cache-control: public, max-age=86400`, correct content type, 404 if missing. The key is checked against `^[a-z0-9-]+\.(jpg|webp)$` (also covers the hashed keys).
  - `/api/markets` includes `image`, `image_credit`, `image_source` (null when unset).
- **Front end:** in `createMarker()` the sheet gets a 16:9 banner above the red name header. With a photo it is an `<img>` (`loading="lazy"`, alt text from the market name, async decoding) with the credit as a small caption linking to the source. Without one it is a CSS/SVG placeholder in the brand colours. The close button and drag handle stay readable on top. All text is escaped.
- **Script:** `python3 scripts/upload_photo.py "<market name>" photo.jpg --credit "..." --source URL [--remove]`. It checks the market exists in the live API, the file type and size, and requires credit and source. It uploads with `wrangler r2 object put --remote`, then updates the row with `wrangler d1 execute --remote`. It prints the resulting URL.
- **Docs:** CLAUDE.md gets a short note on the workflow.

## Build order (one commit each, deployable)
1. Placeholder banner and optional-image rendering in `index.html` (no data needed).
2. Schema columns, R2 binding, `/img/` route and API fields, with tests for the key check.
3. `upload_photo.py` and the CLAUDE.md note.

## Left to the builder
Exact placeholder artwork, caption styling, and the script's argument parsing details.
