#!/usr/bin/env zsh
set -euo pipefail

git add -A
if git diff-index --quiet HEAD; then
  print "nothing to commit"
else
  git commit -m "deploy" > /dev/null
  print "committed"
fi

VER=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
DIST=$(mktemp -d)
trap "rm -rf '$DIST'" EXIT

rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.DS_Store' \
  --exclude '*.log' \
  --exclude 'deploy.zsh' \
  ./ "$DIST/"

sed -i '' "s/v=dev/v=$VER/g" "$DIST/index.html"
[[ -f "$DIST/admin.html" ]]       && sed -i '' "s/v=dev/v=$VER/g" "$DIST/admin.html"
[[ -f "$DIST/stats.html" ]]       && sed -i '' "s/v=dev/v=$VER/g" "$DIST/stats.html"
[[ -f "$DIST/users.html" ]]       && sed -i '' "s/v=dev/v=$VER/g" "$DIST/users.html"
[[ -f "$DIST/bests/index.html" ]] && sed -i '' "s/v=dev/v=$VER/g" "$DIST/bests/index.html"
[[ -f "$DIST/bests/beer.html" ]]   && sed -i '' "s/v=dev/v=$VER/g" "$DIST/bests/beer.html"
[[ -f "$DIST/bests/whisky.html" ]] && sed -i '' "s/v=dev/v=$VER/g" "$DIST/bests/whisky.html"

git push -q
print "pushed $VER"

if ! wrangler_out=$(npx wrangler pages deploy "$DIST" \
  --project-name harlanswitzer \
  --branch main \
  --commit-dirty=true 2>&1); then
  print "$wrangler_out" | grep -v -E '(⛅|─{3,}|🪵|update available)' | sed '/^[[:space:]]*$/d'
  exit 1
fi

url=$(print "$wrangler_out" | grep -o 'https://[^ ]*pages\.dev' | tail -1)
print "deployed $url"
