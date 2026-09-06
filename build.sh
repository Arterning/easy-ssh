#!/usr/bin/env sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WEB_ROOT="$PROJECT_ROOT/web"
API_ROOT="$PROJECT_ROOT/api"
OUTPUT="$PROJECT_ROOT/easyssh"

echo "[1/2] Building React application..."
cd "$WEB_ROOT"
pnpm run build

echo "[2/2] Building EasySSH executable..."
cd "$API_ROOT"
go build -trimpath -ldflags="-s -w" -o "$OUTPUT" ./cmd/server

echo "Built: $OUTPUT"
