# Trading Cards Cloudflare Pages Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Serve the trading cards React frontend from Cloudflare Pages edge instead of the Google Cloud VM, eliminating the VM round-trip on every page load.

**Architecture:** The proxy function at `functions/trading-cards/[[path]].js` currently forwards all requests to the VM. After this change, static React assets (HTML, JS, CSS) are served via `context.env.ASSETS` from the Pages deployment. Only `/api/*` and `/cards/*` (card images) continue proxying to the VM.

**Tech Stack:** Cloudflare Pages Functions, Cloudflare Pages Assets (ASSETS binding), CRA (Create React App) build output, rsync over SSH.

---

### Task 1: Copy React build from VM into the repo

**Files:**
- Create: `trading-cards/` (directory with CRA build contents)
- Create: `sync-trading-cards-ui.zsh` (script to re-sync when React app changes)

**Step 1: Rsync the build from the VM**

```bash
mkdir -p /Users/harlan/Documents/personal/code/programs/harlanswitzer.com/trading-cards
rsync -av --delete \
  -e "ssh -i ~/.ssh/google_compute_engine" \
  harlan@34.58.228.173:/opt/trading_cards_db/app/ui/client/build/ \
  /Users/harlan/Documents/personal/code/programs/harlanswitzer.com/trading-cards/
```

Expected: files copied — index.html, asset-manifest.json, favicon.ico, logo192.png,
logo512.png, manifest.json, robots.txt, static/css/*, static/js/*

**Step 2: Verify the files are present**

```bash
ls /Users/harlan/Documents/personal/code/programs/harlanswitzer.com/trading-cards/
ls /Users/harlan/Documents/personal/code/programs/harlanswitzer.com/trading-cards/static/js/ | head -5
```

Expected: index.html and static/ directory present with hashed JS/CSS filenames.

**Step 3: Write the sync script**

Create `sync-trading-cards-ui.zsh` at the repo root:

```zsh
#!/usr/bin/env zsh
# Sync the trading cards React build from the VM into the Pages deployment.
# Run this whenever the React app changes, then run deploy.zsh.
set -euo pipefail

SCRIPT_DIR="${0:A:h}"

print "syncing trading cards UI from VM..."
rsync -av --delete \
  -e "ssh -i ~/.ssh/google_compute_engine" \
  harlan@34.58.228.173:/opt/trading_cards_db/app/ui/client/build/ \
  "$SCRIPT_DIR/trading-cards/"

print "done — run ./deploy.zsh to deploy"
```

```bash
chmod +x /Users/harlan/Documents/personal/code/programs/harlanswitzer.com/sync-trading-cards-ui.zsh
```

**Step 4: Commit**

```bash
cd /Users/harlan/Documents/personal/code/programs/harlanswitzer.com
git add trading-cards/ sync-trading-cards-ui.zsh
git commit -m "add trading cards react build and sync script"
```

---

### Task 2: Update the proxy function to serve static assets from Pages

**Files:**
- Modify: `functions/trading-cards/[[path]].js`

The key change: when the request is for a static React asset (HTML, JS, CSS, icons),
serve it from `context.env.ASSETS` instead of proxying to the VM.

The ASSETS binding serves files by URL path. Since the files live at `trading-cards/index.html`
and `trading-cards/static/...` in the repo, we construct the asset URL as
`/trading-cards` + pathStr (e.g. `/trading-cards/static/js/main.chunk.js`).

The root path `/` maps to `index.html`.

Auth check still runs before serving assets (session required). The allowed-users check
continues to be skipped for static assets (same as before).

**Step 1: Update the isStaticAsset check and add index.html/robots.txt**

Replace the current `isStaticAsset` line and the entire proxy section with the new logic.

New `functions/trading-cards/[[path]].js`:

```javascript
import { verifySession } from '../_auth.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isAllowed(username, env) {
  const raw = env.TRADING_CARDS_ALLOWED_USERS || '';
  if (!raw.trim()) return false;
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    .includes(username.toLowerCase());
}

export async function onRequest(context) {
  const { request, env, params } = context;

  const pathParts = Array.isArray(params.path) ? params.path : [];
  const pathStr = pathParts.length > 0 ? '/' + pathParts.join('/') : '/';
  const isStaticAsset = pathStr === '/' || pathStr === '/index.html' ||
    pathStr.startsWith('/static/') || pathStr === '/favicon.ico' ||
    pathStr === '/manifest.json' || pathStr === '/logo192.png' || pathStr === '/logo512.png' ||
    pathStr === '/asset-manifest.json' || pathStr === '/robots.txt';

  // auth: require valid session for all requests
  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  // serve static react assets from cloudflare pages (no vm round-trip)
  if (isStaticAsset) {
    const assetPath = (pathStr === '/' || pathStr === '/index.html')
      ? '/trading-cards/index.html'
      : '/trading-cards' + pathStr;
    const assetUrl = new URL(request.url);
    assetUrl.pathname = assetPath;
    const assetResp = await context.env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET', headers: request.headers }));
    const respHeaders = new Headers(assetResp.headers);
    if (pathStr.startsWith('/static/')) {
      respHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      respHeaders.set('Cache-Control', 'public, max-age=3600');
    }
    return new Response(assetResp.body, { status: assetResp.status, headers: respHeaders });
  }

  // non-static: check allowed users, then proxy to vm
  const user = await env.db.prepare(
    'SELECT id, username FROM users WHERE id = ?'
  ).bind(session.user_id).first();
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!isAllowed(user.username, env)) return json({ error: 'forbidden' }, 403);

  const origin = env.TRADING_CARDS_ORIGIN;
  if (!origin) return json({ error: 'origin not configured' }, 500);
  const url = new URL(request.url);
  const targetUrl = origin.replace(/\/$/, '') + pathStr + url.search;

  // forward headers, inject proxy secret
  const headers = new Headers(request.headers);
  headers.set('X-Trading-Proxy-Secret', env.TRADING_CARDS_PROXY_SECRET || '');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ray');
  headers.delete('cf-ipcountry');
  headers.delete('cf-visitor');

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  let resp;
  try {
    resp = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: hasBody ? request.body : null,
      ...(hasBody ? { duplex: 'half' } : {}),
    });
  } catch (err) {
    console.error('[trading-cards proxy] fetch error:', err);
    return json({ error: 'origin unreachable' }, 502);
  }

  const respHeaders = new Headers(resp.headers);
  respHeaders.set('Cache-Control', 'no-store');
  respHeaders.delete('transfer-encoding');
  respHeaders.delete('connection');

  return new Response(resp.body, {
    status: resp.status,
    headers: respHeaders,
  });
}
```

**Step 2: Commit**

```bash
cd /Users/harlan/Documents/personal/code/programs/harlanswitzer.com
git add functions/trading-cards/[[path]].js
git commit -m "serve trading cards static assets from cloudflare pages instead of vm"
```

---

### Task 3: Deploy and verify

**Step 1: Deploy**

```bash
cd /Users/harlan/Documents/personal/code/programs/harlanswitzer.com
./deploy.zsh
```

Expected: deploys to Cloudflare Pages, prints the pages.dev URL.

**Step 2: Verify the page loads**

Open `https://harlanswitzer.com/trading-cards/` in the browser (or the pages.dev URL).
Expected: React app loads, login/auth works, no errors in browser console.

**Step 3: Verify API calls still work**

Log in and navigate to the verification UI. Load a card for review.
Expected: card image loads, card data loads from `/api/*`, pass/fail buttons work.

**Step 4: Verify static assets are served from Pages (not VM)**

Open browser devtools → Network tab. Reload the page.
Check `index.html` and a `/static/js/*.js` file — the response should have no round-trip
to the VM (fast TTFB, served from Cloudflare edge colo).

**Step 5: Verify auth gate still works**

In an incognito window, go to `https://harlanswitzer.com/trading-cards/`.
Expected: 401 response / redirect to login, React app does not load unauthenticated.

---

### Task 4: Downsize the VM (optional, after confirming everything works)

The VM no longer needs to serve static files — only API requests hit it. It can be
downsized to a smaller/cheaper GCP instance type.

**Step 1: Check current machine type**

From your local machine, using the GCP console or:
```bash
ssh -i ~/.ssh/google_compute_engine harlan@34.58.228.173 \
  "curl -s 'http://metadata.google.internal/computeMetadata/v1/instance/machine-type' -H 'Metadata-Flavor: Google'"
```

**Step 2: Downsize via GCP console**

In the GCP console: Compute Engine → VM instances → click the trading-cards instance →
Edit → change machine type to e2-small or e2-micro (depending on API load) → save.
The VM must be stopped to change machine type.

**Step 3: Restart and verify API still works**

After VM restarts, navigate to the trading cards UI and verify card loading still works.

---

## Future: migrate card images to R2 (not in scope now)

When ready to further reduce VM load:
1. Create R2 bucket `trading-cards-images`
2. Sync existing images: `rclone sync vm:/opt/trading_cards_db/cards/ r2:trading-cards-images/`
3. Bind R2 bucket to Pages project
4. Update `server.js` to write new images to R2 via API
5. Update proxy to serve `/cards/*` from R2 binding instead of VM
