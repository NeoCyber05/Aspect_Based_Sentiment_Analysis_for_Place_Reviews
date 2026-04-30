#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$ROOT_DIR"
go test ./crawler/backend/...

cd "$ROOT_DIR/crawler/frontend"
npm run build
