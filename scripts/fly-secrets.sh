#!/usr/bin/env bash
# Push the provider keys from .env into Fly as secrets, under their PLAIN names.
#
# The app is the only reason those vars carry an EXPO_PUBLIC_ prefix locally
# (dashboard/server.ts and scripts/scrape-nurseries.ts still read the prefixed
# names - TODOS H1). Nothing on the server wants the prefix: server/index.ts
# reads the plain name first and only falls back to EXPO_PUBLIC_* for local dev.
#
# Values are never printed. `fly secrets set` reads them from this process's
# environment via --stage, so they do not land in shell history either.
#
# Usage:  ./scripts/fly-secrets.sh [app-name]
set -euo pipefail

APP="${1:-plantai-api}"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"

[ -f "$ENV_FILE" ] || { echo "No .env at $ENV_FILE"; exit 1; }

# Read one value out of .env without sourcing the file (it has comments and
# values with '=' in them).
val() { grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

# plain fly secret name  <-  .env var name
declare -a PAIRS=(
  "FIRECRAWL_API_KEY:EXPO_PUBLIC_FIRECRAWL_API_KEY"
  "OPENAI_API_KEY:EXPO_PUBLIC_OPENAI_API_KEY"
  "TAVILY_API_KEY:EXPO_PUBLIC_TAVILY_API_KEY"
  "GOOGLE_MAPS_API_KEY:EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"
  "PLANTNET_API_KEY:EXPO_PUBLIC_PLANTNET_API_KEY"
  "API_SHARED_SECRET:API_SHARED_SECRET"
)

args=()
missing=()
for pair in "${PAIRS[@]}"; do
  name="${pair%%:*}"
  source_var="${pair##*:}"
  v="$(val "$source_var" || true)"
  if [ -z "$v" ]; then
    missing+=("$source_var")
  else
    args+=("$name=$v")
    echo "  will set $name  (${#v} chars from $source_var)"
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "Missing in .env: ${missing[*]}"
  exit 1
fi

echo
echo "Setting ${#args[@]} secrets on app '$APP'..."
# --stage writes the secrets without triggering a deploy; `fly deploy` picks
# them up. Keeps the secret write and the first release as two separate steps.
flyctl secrets set --stage --app "$APP" "${args[@]}"
echo
echo "Done. Verify names (never values) with:  flyctl secrets list --app $APP"
