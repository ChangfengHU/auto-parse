#!/bin/bash
# 构建并推送镜像脚本
# 用法：./deploy/build-push.sh

# 加载 .env 环境变量
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
else
    echo "⚠️ Warning: .env file not found."
fi

SERVICE_NAME="doouyin"
IMAGE_NAME="${DOCKER_REGISTRY:-registry.cn-hangzhou.aliyuncs.com}/vyibc/${SERVICE_NAME}:latest"

# 检查凭证
if [[ -z "$DOCKER_USERNAME" || -z "$DOCKER_PASSWORD" ]]; then
    echo "❌ Error: Missing DOCKER_USERNAME or DOCKER_PASSWORD in .env"
    exit 1
fi

echo "🏗  Starting build for $SERVICE_NAME..."

# 检查是否在项目根目录
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory."
    exit 1
fi

# 构建镜像
docker build -f deploy/Dockerfile -t "$SERVICE_NAME:latest" .
    
# 打标签
docker tag "$SERVICE_NAME:latest" "$IMAGE_NAME"

echo "📤 Pushing image to registry..."

# 登录阿里云
echo "$DOCKER_PASSWORD" | docker login --username "$DOCKER_USERNAME" --password-stdin "$DOCKER_REGISTRY"

# 推送
docker push "$IMAGE_NAME"

echo "✅ Build and Push completed: $IMAGE_NAME"
