#!/usr/bin/env bash
#
# Packages the app and deploys it to an existing Azure App Service web app.
#
# Usage: ./scripts/deploy.sh <resource-group> <app-name>
#
# Requires: az, logged in, with Contributor on the resource group.

set -euo pipefail

RG="${1:-}"
APP="${2:-}"

if [[ -z "$RG" || -z "$APP" ]]; then
  echo "Usage: $0 <resource-group> <app-name>" >&2
  exit 64
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$ROOT/release"
ZIP="$RELEASE_DIR/azure-sandbox-manager.zip"

echo "==> Running tests before packaging"
( cd "$ROOT" && npm test )

echo "==> Packaging"
mkdir -p "$RELEASE_DIR"
rm -f "$ZIP"
( cd "$ROOT" && zip -q -r "$ZIP" server.js package.json src -x '*.DS_Store' )
echo "    $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "==> Deploying to $APP"
# az webapp deploy is known to hang after a deployment that actually
# succeeded; the log check below is the authoritative result.
az webapp deploy \
  --resource-group "$RG" \
  --name "$APP" \
  --src-path "$ZIP" \
  --type zip \
  --only-show-errors || echo "    (deploy command returned non-zero — checking the real status)"

echo "==> Deployment status according to Azure"
az webapp log deployment list \
  --resource-group "$RG" \
  --name "$APP" \
  --query "[0].{status:status, message:message, time:end_time}" \
  -o table

echo "==> Health check"
HOST="$(az webapp show -g "$RG" -n "$APP" --query defaultHostName -o tsv)"
for attempt in 1 2 3 4 5 6; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "https://$HOST/healthz" || echo 000)"
  if [[ "$CODE" == "200" ]]; then
    echo "    https://$HOST/healthz -> 200"
    exit 0
  fi
  echo "    attempt $attempt: HTTP $CODE (cold start can take a while)"
  sleep 10
done

echo "    /healthz never answered 200. Check the logs:" >&2
echo "    az webapp log tail -g $RG -n $APP" >&2
exit 1
