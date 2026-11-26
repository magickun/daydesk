#!/usr/bin/env bash
# 在本机构建并推到阿里云 ACR。读项目根目录 .env 里的 DAYDESK_IMAGE
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "缺少 .env，请先：cp .env.example .env 并填写 DAYDESK_IMAGE" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a && source .env && set +a

if [[ -z "${DAYDESK_IMAGE:-}" ]]; then
  echo "请在 .env 设置 DAYDESK_IMAGE，例如 registry.cn-hangzhou.aliyuncs.com/<命名空间>/daydesk:latest" >&2
  exit 1
fi

echo "构建 → ${DAYDESK_IMAGE}"
docker build -t "${DAYDESK_IMAGE}" .

echo "推送 ${DAYDESK_IMAGE}"
docker push "${DAYDESK_IMAGE}"

echo "完成。在 ECS 上执行：./scripts/ecs-update.sh"