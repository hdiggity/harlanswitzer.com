# harlanswitzer.com — project memory

## stack
- Cloudflare Pages + Pages Functions (ES modules)
- Cloudflare D1 (SQLite) accessed via `env.db`
- No build step — plain HTML/CSS/JS files deployed via `deploy.zsh`
- Auth: HMAC-signed session cookies, `verifySession()` in `functions/_auth.js`

## key paths
- `schema.sql` — D1 schema (apply manually before deploy)
- `deploy.zsh` — builds dist, runs `sed` for cache-busting `v=dev`, pushes git, runs wrangler
- `functions/_auth.js` — shared session verification
- `functions/_middleware.js` — bot score blocking + request logging
- `functions/admin/api.js` — admin stats API (GET only)
- `functions/admin/users.js` — user management (GET/PATCH/DELETE)
- `functions/bests/api.js` — beer ranking API (GET/POST)
- `js/bests.js` — bests frontend
- `bests/index.html` — bests page (served at /bests)

## patterns
- All function routes export `onRequest` (or `onRequestGet` for GET-only)
- Auth check first, then `if (!env.db) return 500`
- `json(obj, status)` helper pattern used in all function files
- Frontend pages: check `/auth/me` on init, redirect to `/` if not logged in
- CSS vars: `--bg`, `--fg` (#6d28d9 purple), `--muted`, `--border`, `--font`
- Admin nav links use `.hd-btn` class; hub nav uses `.hub-link` class

## bests feature
- Tables: `bests_beers`, `bests_rank_sessions`, `bests_rank_choices`
- Access controlled by `BESTS_ALLOWED_USERS` CSV env var
- One-time seed from Google Sheet via `BESTS_SHEET_ID` env var (sheet export CSV)
- Scoring: n<=2 → null; else `round(10 * (1 - r/(n-1)), 1)` for 0-based rank r
- Pairwise ranking: binary insertion sort, session tracks low/high bounds

## env vars
- `SESSION_SIGNING_KEY` — HMAC key for session tokens
- `IP_HASH_SALT` — for IP hashing in request logs
- `BESTS_ALLOWED_USERS` — CSV of allowed usernames for /bests
- `BESTS_SHEET_ID` — Google Sheet ID for one-time beer seed
