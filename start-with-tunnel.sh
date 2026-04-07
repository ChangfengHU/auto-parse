#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=1007
TUNNEL_SCRIPT="/Users/huchangfeng/vyibc-base-ability/project-tunnel.sh"

echo "🚀 Doouyin - 启动脚本"
echo "================================"
echo ""

# 检查并停止旧进程
echo "🔍 检查并停止旧进程..."
OLD_PID=$(lsof -ti :${PORT} 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
  echo "  → 停止旧进程 (PID: $OLD_PID)"
  kill "$OLD_PID" 2>/dev/null || true
  sleep 1
fi

# 清除 Next.js dev 锁文件
rm -f "${ROOT_DIR}/.next/dev/lock" 2>/dev/null || true

# 启动应用
echo ""
echo "🎨 启动 Next.js 服务 (端口: ${PORT})..."
cd "${ROOT_DIR}"
nohup npm run dev > "${ROOT_DIR}/.run.log" 2>&1 &
APP_PID=$!
echo "  → 进程 PID: $APP_PID"

# 等待应用启动
echo "  → 等待应用就绪..."
for i in {1..30}; do
  if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
    echo "  ✅ 应用就绪"
    break
  fi
  sleep 1
  if [ $i -eq 30 ]; then
    echo "  ❌ 应用启动超时"
    echo ""
    echo "查看日志："
    tail -20 "${ROOT_DIR}/.run.log"
    exit 1
  fi
done

# 注册公网域名
echo ""
echo "🌐 注册公网域名..."
SKIP_BUILD=1 SUBDOMAIN="doouyin-domain" bash "${TUNNEL_SCRIPT}" start --port ${PORT}

echo ""
echo "================================"
echo "✅ 全部启动完成！"
echo ""
echo "本地服务："
echo "  - 应用: http://127.0.0.1:${PORT}"
echo ""
echo "日志文件："
echo "  - 应用: ${ROOT_DIR}/.run.log"
echo ""
echo "公网域名信息已显示在上方 👆"
echo ""
echo "提示："
echo "  - 查看日志: tail -f .run.log"
echo "  - 查看隧道状态: bash ${TUNNEL_SCRIPT} status"
echo "  - 停止隧道: bash ${TUNNEL_SCRIPT} stop"
echo ""
