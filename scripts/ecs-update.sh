#!/usr/bin/env bash
# 在 ECS 上拉最新镜像并重启（不 build）。可选 git pull 只更新 compose/Caddy/.env
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -d .git ]] && git rev-parse --git-dir >/dev/null 2>&1; then
  git pull --ff-only
fi

if [[ ! -f .env ]]; then
  echo "缺少 .env" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a && source .env && set +a

if [[ -z "${DAYDESK_IMAGE:-}" ]]; then
  echo "DAYDESK_IMAGE 未设置。若你走 ECS 本机构建，用：docker compose up -d --build" >&2
  exit 1
fi

docker compose -f compose.prod.yml pull daydesk
docker compose -f compose.prod.yml up -d

if grep -q '^DOMAIN=' .env 2>/dev/null && [[ -n "$(grep '^DOMAIN=' .env | cut -d= -f2- | tr -d ' \"')" ]]; then
  docker compose -f compose.prod.yml --profile https up -d
fi

echo "Daydesk 已更新。"