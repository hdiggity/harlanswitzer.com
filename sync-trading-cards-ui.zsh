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
