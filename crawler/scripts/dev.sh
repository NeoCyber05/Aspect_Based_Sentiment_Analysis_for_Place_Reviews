#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "Starting backend on :8090"
(cd "$ROOT_DIR" && go run ./crawler/backend/cmd/server) &
BACKEND_PID=$!

echo "Starting frontend on :5173"
(cd "$ROOT_DIR/crawler/frontend" && npm run dev) &
FRONTEND_PID=$!

trap 'kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true' EXIT
wait
