
#!/usr/bin/env zsh
set -euo pipefail

# build id used for cache-busting (short git sha, else epoch)
VER=$(git rev-parse --short HEAD 2>/dev/null || date +%s)

# stage deploy in a temp dir
DIST=$(mktemp -d)
trap "rm -rf '$DIST'" EXIT

# copy site into temp dir (exclude git + node_modules + mac cruft)
# note: keep package.json etc out of deploy unless you want them public
rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.DS_Store' \
  --exclude '*.log' \
  ./ "$DIST/"

# helper: rename a file to include .$VER before extension
# prints the new basename
rename_with_ver() {
  local p="$1"
  local dir base stem ext new
  dir="${p:h}"
  base="${p:t}"
  stem="${base:r}"
  ext="${base:e}"
  if [[ -n "$ext" ]]; then
    new="${stem}.${VER}.${ext}"
  else
    new="${stem}.${VER}"
  fi
  mv -f "$p" "$dir/$new"
  print -r -- "$new"
}

# rewrite references in html files for css/js assets
rewrite_html_refs() {
  local html="$1"
  local old="$2"
  local new="$3"

  # replace both absolute and relative refs
  sed -i '' \
    -e "s#\"/js/${old}\"#\"/js/${new}\"#g" \
    -e "s#\"js/${old}\"#\"js/${new}\"#g" \
    -e "s#\"/styles/${old}\"#\"/styles/${new}\"#g" \
    -e "s#\"styles/${old}\"#\"styles/${new}\"#g" \
    "$html"
}

# html files to rewrite
HTML_FILES=()
[[ -f "$DIST/index.html" ]] && HTML_FILES+=("$DIST/index.html")
[[ -f "$DIST/admin.html" ]] && HTML_FILES+=("$DIST/admin.html")

# rename all js files under js/ and rewrite html refs
if [[ -d "$DIST/js" ]]; then
  for f in "$DIST/js"/*.js(N); do
    old="${f:t}"
    new="$(rename_with_ver "$f")"
    for html in "${HTML_FILES[@]}"; do
      rewrite_html_refs "$html" "$old" "$new"
    done
  done
fi

# rename all css files under styles/ and rewrite html refs
if [[ -d "$DIST/styles" ]]; then
  for f in "$DIST/styles"/*.css(N); do
    old="${f:t}"
    new="$(rename_with_ver "$f")"
    for html in "${HTML_FILES[@]}"; do
      rewrite_html_refs "$html" "$old" "$new"
    done
  done
fi

# keep your existing querystring cache-buster replacement if present
# (safe to leave even if you no longer use v=dev)
for html in "${HTML_FILES[@]}"; do
  sed -i '' "s/v=dev/v=$VER/g" "$html" || true
done

# push repo changes (optional; you can delete this if you don't want auto-push)
# note: this pushes your current working tree, not the DIST dir.
# keep as-is to match your previous behavior.
git push

# deploy the temp dir
authflag="--commit-dirty=true"
npx wrangler pages deploy "$DIST" --project-name harlanswitzer --branch main $authflag
