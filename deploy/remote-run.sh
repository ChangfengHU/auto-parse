#!/bin/bash
# 远程拉取并启动镜像脚本 (在远程服务器上执行)
# 用法：./remote-run.sh [DOCKER_PASSWORD]

# 1. 优先读取命令行参数
CLI_PASS="$1"

SERVICE_NAME="doouyin"
ENV_FILE=".env"
DOCKER_REGISTRY="registry.cn-hangzhou.aliyuncs.com"
IMAGE_NAME="${DOCKER_REGISTRY}/vyibc/${SERVICE_NAME}:latest"
PORT=1007

# 2. 读取 Docker 密码
# 优先级: 命令行参数 > .env 文件 > 交互式输入
ENV_PASS=""
if [ -f "$ENV_FILE" ]; then
    ENV_PASS=$(grep '^DOCKER_PASSWORD=' "$ENV_FILE" | cut -d '=' -f2-)
fi

# 最终使用的密码
DOCKER_PASSWORD="${CLI_PASS:-$ENV_PASS}"

# 如果密码仍为空，则交互式输入
if [ -z "$DOCKER_PASSWORD" ]; then
    read -s -p "🔑 请输入 Docker 仓库密码: " DOCKER_PASSWORD
    echo ""
fi

# 3. 读取 Docker 用户名 (优先 .env)
DOCKER_USERNAME=$(grep '^DOCKER_USERNAME=' "$ENV_FILE" | cut -d '=' -f2-)
if [ -z "$DOCKER_USERNAME" ]; then
    read -p "👤 请输入 Docker 用户名: " DOCKER_USERNAME
fi

echo "🚀 Starting deployment for $SERVICE_NAME..."

# 4. 登录 Docker
echo "$DOCKER_PASSWORD" | docker login --username "$DOCKER_USERNAME" --password-stdin "$DOCKER_REGISTRY"

# 5. 拉取最新镜像
docker pull "$IMAGE_NAME"

# 6. 停止并删除旧容器
if [ "$(docker ps -aq -f name=$SERVICE_NAME)" ]; then
    echo "Stopping existing container..."
    docker stop $SERVICE_NAME
    docker rm $SERVICE_NAME
fi

# 7. 准备运行时环境变量 (OSS等)
ENV_ARGS=""
if [ -f "$ENV_FILE" ]; then
    while IFS='=' read -r key value; do
        # 排除空行和注释
        [[ -z "$key" || "$key" =~ ^# ]] && continue
        # 只提取需要的变量
        if [[ "$key" == OSS_* || "$key" == DOUYIN_COOKIE ]]; then
            ENV_ARGS="$ENV_ARGS -e $key=$value"
        fi
    done < "$ENV_FILE"
fi

# 8. 启动新容器
echo "Starting container..."
# 注意：这里直接使用 eval 执行带有变量的命令
docker run -d \
  --name $SERVICE_NAME \
  --restart unless-stopped \
  -p $PORT:1007 \
  $ENV_ARGS \
  -v $(pwd)/.douyin-cookie.json:/app/.douyin-cookie.json \
  "$IMAGE_NAME"

# 9. 清理旧镜像
docker image prune -f

echo "✅ Service deployed successfully on port $PORT"
