#!/usr/bin/env bash
# Cursor cloud-agent install. Idempotent. Must exit.
#
# Docker is not used: the default Cursor VM image has no Docker, and a direct
# Postgres install is what actually starts here. Packages only; the server is
# started by .cursor/cloud-start.sh on every boot.
set -euo pipefail

if ! command -v node >/dev/null 2>&1 || ! node -e 'const [maj,min]=process.versions.node.split(".").map(Number); if(!(maj>22||(maj===22&&min>=22))) process.exit(1)'; then
  NODE_VERSION=22.23.4
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    | sudo tar -xJ -C /usr/local --strip-components=1 --no-same-owner
fi
node -v

if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
fi

npm ci

if [ ! -f .env ]; then
  cp .env.example .env
fi

# db:migrate and db:seed read the process environment, not the .env file.
# Login shells source /etc/profile.d, so put the .env.example values there.
profile="$(mktemp)"
{
  echo "# Dev defaults copied from .env.example. Not production secrets."
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "" | \#*) continue ;;
    esac
    case "$line" in
      *=*)
        key="${line%%=*}"
        val="${line#*=}"
        [ -n "$val" ] || continue
        case "$key" in
          *[!A-Za-z0-9_]*) continue ;;
        esac
        printf 'export %s=%s\n' "$key" "$val"
        ;;
    esac
  done < .env.example
} >"$profile"
sudo cp "$profile" /etc/profile.d/foa-dev.sh
sudo chmod 644 /etc/profile.d/foa-dev.sh
rm -f "$profile"
