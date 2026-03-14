# trading cards: serve frontend from cloudflare pages

date: 2026-03-14

## problem

every request to /trading-cards/ — html, js bundles, css, images, api calls — proxies through
cloudflare pages functions to a google cloud vm. this adds a vm round-trip to every page load,
making initial load slow.

## goal

serve the react frontend (html, js, css) from cloudflare edge. keep all existing functionality.
vm still handles api and card image requests unchanged.

## architecture

before:
  user -> cloudflare pages function -> google cloud vm (serves everything)

after:
  user -> cloudflare pages function -> cloudflare pages assets (html/js/css)
  user -> cloudflare pages function -> google cloud vm (api/images only)

## components

react build in repo
  - trading-cards/ directory added to harlanswitzer.com repo
  - contains cra build output: index.html, static/, manifest.json, favicon.ico, etc.
  - committed to git, deployed via deploy.zsh alongside the rest of the site

proxy function update (functions/trading-cards/[[path]].js)
  - static asset paths (/static/*, /favicon.ico, /manifest.json, /logo192.png,
    /logo512.png, /asset-manifest.json, /robots.txt, and root /) served via
    context.env.ASSETS.fetch() pointing to /trading-cards<path> in pages deployment
  - /api/* and /cards/* still proxy to vm unchanged
  - auth check still applies to all non-static requests (static assets skip auth as before)

build workflow
  - new script: sync-trading-cards-ui.zsh (or similar) on local mac
  - rsync build output from vm: scp or rsync trading-cards-vm:build/ -> trading-cards/
  - run deploy.zsh to deploy

vm unchanged
  - node.js server continues to serve /api/* and /cards/* exactly as before
  - python pipeline, sqlite, file system all untouched
  - can be downsized to smaller instance after confirming everything works

## path routing in the proxy

cra builds with absolute asset paths (e.g. <script src="/static/js/main.chunk.js">).
currently the proxy strips the /trading-cards prefix before forwarding to the vm,
so /trading-cards/static/js/main.chunk.js becomes /static/js/main.chunk.js on the vm.

for pages assets: the file lives at trading-cards/static/js/main.chunk.js in the repo,
so the assets url must be /trading-cards/static/js/main.chunk.js.
the proxy constructs this as: new URL('/trading-cards' + pathStr, request.url).

## what changes

- functions/trading-cards/[[path]].js: add assets branch for static paths
- trading-cards/ directory: new, contains react build output
- docs/plans/: this file
- deploy.zsh: no change needed (already deploys everything in the repo)
- vm: no changes

## what does not change

- auth flow
- api endpoints
- card image serving
- python ml pipeline
- sqlite database
- file upload/download
- verification workflow
- all existing functionality
