#!/bin/bash

PORT=1007

echo "🔄 清理旧进程..."

# 杀所有 next dev 进程（包括后台启动、还没绑定端口的）
pkill -f "next dev" 2>/dev/null

# 再杀仍然占用端口的进程（兜底）
PID=$(lsof -t -i:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  kill -9 $PID 2>/dev/null
fi

# 清除 Next.js dev 锁文件，防止 "Unable to acquire lock" 报错
rm -f .next/dev/lock

sleep 1

echo "🚀 正在启动 Next.js 开发服务器..."
npm run dev
