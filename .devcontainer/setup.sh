#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Preserve local configuration and all SQLite data across rebuilds.
if [ ! -f .env ]; then cp .env.example .env; fi
npm ci --ignore-scripts --no-audit --no-fund
npm run db:setup
