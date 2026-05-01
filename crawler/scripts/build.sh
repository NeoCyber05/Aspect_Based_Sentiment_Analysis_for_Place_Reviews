#!/usr/bin/env bash
set -euo pipefail

CRAWLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$CRAWLER_DIR/backend"
go test ./...

cd "$CRAWLER_DIR/frontend"
npm run build
