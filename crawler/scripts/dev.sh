#!/usr/bin/env bash
set -euo pipefail

CRAWLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Starting backend on :8090"
(cd "$CRAWLER_DIR/backend" && go run ./cmd/server) &
BACKEND_PID=$!

echo "Starting frontend on :5173"
(cd "$CRAWLER_DIR/frontend" && npm run dev) &
FRONTEND_PID=$!

trap 'kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true' EXIT
wait
