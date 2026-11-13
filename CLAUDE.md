# Berlin Christmas markets map

Live at https://xmas.dariuszsiedlecki.com. A single-page Leaflet map (`index.html`) served by a Cloudflare Worker, which also exposes the API and an admin page. The Worker reads from a D1 database, and D1 is the source of truth for market data.

## Layout

- `index.html`: the whole front end (HTML, CSS, JS inline, ~200 KB). It fetches `/api/markets` at runtime. It also holds a static, crawlable market list and JSON-LD between generated markers, for SEO. Never hand-edit the generated block.
- `worker/src/index.js`: Worker. Routes: `/api/markets`, `/api/info`, `/api/suggest` (rate-limited POST), `/api/admin/*` and `/admin` (behind Cloudflare Access), `/sitemap.xml`, `/market/<slug>`. Everything else falls through to static assets.
- `worker/src/admin.html`: admin UI. Markets tab: table of every market with inline editing, an expandable row for dates, open days and community info, add and delete (typed-name confirmation). Suggestions tab: approve or reject community edits. Markets are edited through `/api/admin/markets*`.
- `worker/src/validate.js`: pure validation for admin edits (dates, coordinates, name slugs). `worker/src/access.js`: the `DEV_ADMIN` local bypass. Tests sit next to them as `*.test.js`.
- `worker/wrangler.jsonc`: Worker config. The assets directory is `..` (the repo root), filtered by `.assetsignore`. It also holds the D1 binding, the rate limit and the Access vars.
- `worker/schema.sql`, `worker/seed.sql`: D1 schema and seed data.
- `scripts/`: Python 3 stdlib only.
  - `markets_api.py`: fetches the live API.
  - `generate_seo_content.py`: rewrites the SEO block in `index.html` from the API.
  - `check_berlin_dates.py`: compares our dates with berlin.de. It only reports. Run it before each season.
- `docs/superpowers/specs/`: design docs.

## Deploying

Pushing to `main` deploys. `.github/workflows/deploy.yml` runs `npx wrangler@4 deploy` from `worker/` with the `CLOUDFLARE_API_TOKEN` repo secret. It skips changes that only touch `docs/**`, `README.md` or `CLAUDE.md`. `CLAUDE.md` is also listed in `.assetsignore` so it is not served publicly.

- `.github/workflows/export-markets.yml` runs nightly (03:17 UTC) and on demand. It regenerates the SEO block in `index.html` from the live API. If that changed anything, it commits "Update markets from database", pushes, and deploys. Pushes made with `GITHUB_TOKEN` don't trigger other workflows, which is why it deploys itself.
- That bot commit lands on `main`, so run `git pull --rebase` before pushing.
- Manual deploy, only when CI is unavailable: `cd worker && npx wrangler@4 deploy`. The deploy uploads the whole repo root as assets, so check `git status` first.
- This project has `worker/wrangler.jsonc`, so use Wrangler here, not the `cf` CLI.
- Market data changes (dates, coordinates, new markets) go into the D1 database, not into files. The API picks them up within about a minute and the nightly job refreshes the SEO block. There is no `markets.json` any more.
- Before changing the schema, write the SQL in `worker/schema.sql` and apply it with `npx wrangler@4 d1 execute berlin-xmas-markets --remote --file=...`. Ask the user before running anything destructive against the remote database.

## Local development

- Worker and site: `cd worker && npx wrangler@4 dev --local-upstream localhost:8787` (without the flag the Worker sees the production host). Local secrets go in `worker/.dev.vars` (gitignored). Set `DEV_ADMIN=1` there to open `/admin` on localhost without Cloudflare Access; never put it in `wrangler.jsonc`. First run: apply `schema.sql` and `seed.sql` with `wrangler d1 execute berlin-xmas-markets --local --file=...`.
- Unit tests: `cd worker && node --test src/*.test.js`.
- `index.html` is a static file, so for front-end-only work open it through the dev server so `/api/markets` resolves.
- Verify UI changes in a browser, on mobile width and desktop width. The mobile bottom sheet, dynamic viewport sizing and scroll locking have been fragile before.

## Committing and pushing

- Work on `main` is the norm for this repo, because every push ships. Keep `main` always deployable.
- Make atomic commits. One logical change per commit: a fix and an unrelated refactor are two commits. Each commit should leave the site working.
- Write messages in the imperative, in the style of the existing history ("Add Cloudflare Web Analytics beacon", "Stop upward swipes on the sheet from scrolling the page behind it"). The subject says what changed and, in the body, why when it isn't obvious.
- Only commit when the user asks. Never commit secrets, `.dev.vars`, `.wrangler/`, `node_modules/` or `__pycache__/`.
- Don't use `--force`, `--no-verify` or `reset --hard` unless the user says so.
- Run `git pull --rebase` before `git push`, because the nightly bot commits to `main`.
- After a push, check that the "Deploy to Cloudflare" run succeeded (`gh run list --limit 3`, then `gh run watch`).

## Engineering practices

- **Small, frequent deploys.** Ship each change as soon as it is done and verified, rather than batching. Small changes are easier to review and revert, and they make a broken deploy easy to trace. If a deploy breaks the site, revert the offending commit first and diagnose afterwards.
- **Test before you ship.** Only the Worker's validation and access rules have automated tests (`node --test`); the rest has none yet:
  - Load the page and exercise the changed flow in a real browser, and check the console for errors.
  - Call changed API endpoints with `curl`.
  - Run `python3 scripts/check_berlin_dates.py` after data changes.
  - When adding logic that can be tested without a browser (Worker handlers, date and filter logic, the SEO generator), add a test with it. Reproduce a bug with a failing test first where practical.
- **Verify before claiming done.** Run the check and read its output before saying something works. Say plainly what you did not verify.
- **Keep changes minimal.** Match the surrounding code's style, comment density and naming. Don't refactor unrelated code in the same commit. Don't add dependencies for small things. The front end has none to build, and the scripts use only the stdlib.
- **Keep it secure and accessible.** Validate and rate-limit user input in the Worker (`/api/suggest`). Escape user-provided text before rendering it. Keep the sheet and the lists keyboard- and screen-reader-friendly.
- **Keep the SEO block in sync.** After a change that affects market data or the page structure, regenerate it with `python3 scripts/generate_seo_content.py`, or leave it to the nightly job.
- **Document decisions.** Non-trivial features get a short design doc in `docs/superpowers/specs/`. Update this file when the workflow changes.
