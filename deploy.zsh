#!/usr/bin/env zsh
set -euo pipefail

git add -A
git diff-index --quiet HEAD || git commit -m "deploy"

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

print "pushing $VER..."
git push -q

print "deploying..."
output=$(npx wrangler pages deploy "$DIST" \
  --project-name harlanswitzer \
  --branch main \
  --commit-dirty=true 2>&1)

url=$(print "$output" | grep -o 'https://[^ ]*pages\.dev' | tail -1)
print "done: $url"
