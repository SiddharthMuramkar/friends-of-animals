#!/usr/bin/env bash
# Cursor cloud-agent install. Idempotent. Must exit.
#
# Docker is not used: the default Cursor VM image has no Docker, and a direct
# Postgres install is what actually starts here. This installs the distro's
# Postgres package, whose version may differ from the stack's 18.7. Packages
# only; the server is started by .cursor/cloud-start.sh on every boot.
set -euo pipefail

# Node: match engines.node in package.json (26.x).
NODE_VERSION=26.13.1
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(process.versions.node.split(".")[0] === "26" ? 0 : 1)'; then
  case "$(uname -m)" in
    x86_64) node_arch=x64 ;;
    aarch64 | arm64) node_arch=arm64 ;;
    *) echo "No Node build for $(uname -m)" >&2; exit 1 ;;
  esac
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    | sudo tar -xJ -C /usr/local --strip-components=1 --no-same-owner
  hash -r
fi
node -v

# pnpm: the version in package.json's packageManager. Node 26 ships without
# corepack, so it comes from npm.
pnpm_version="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
if [ "$(pnpm -v 2>/dev/null || true)" != "$pnpm_version" ]; then
  if [ -w "$(npm prefix -g)" ]; then
    npm i -g "pnpm@${pnpm_version}"
  else
    sudo npm i -g "pnpm@${pnpm_version}"
  fi
  hash -r
fi
pnpm -v

if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
fi

pnpm install --frozen-lockfile

if [ ! -f .env ]; then
  cp .env.example .env
fi

# `pnpm db:migrate`, drizzle-kit and Next.js read .env themselves. Login shells
# also get the .env.example values from /etc/profile.d, for psql and anything
# else that reads only the process environment.
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
        printf 'export %s=%q\n' "$key" "$val"
        ;;
    esac
  done < .env.example
} >"$profile"
sudo cp "$profile" /etc/profile.d/foa-dev.sh
sudo chmod 644 /etc/profile.d/foa-dev.sh
rm -f "$profile"
