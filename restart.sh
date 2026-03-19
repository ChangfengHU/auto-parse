#!/bin/bash

# 定义端口 (对应 package.json 中的 "dev": "next dev -p 1007")
PORT=1007

echo "🔄 正在检查端口 $PORT..."

# 查找占用端口的进程 ID
# lsof -t -i:1007 返回占用该端口的 PID
PID=$(lsof -t -i:$PORT)

if [ -n "$PID" ]; then
  echo "⚠️  发现旧进程 (PID: $PID) 正在运行，正在终止..."
  kill -9 $PID
  echo "✅ 旧进程已终止。"
else
  echo "✅ 端口 $PORT 未被占用。"
fi

# 等待一秒确保端口释放
sleep 1

echo "🚀 正在启动 Next.js 开发服务器..."
npm run dev
