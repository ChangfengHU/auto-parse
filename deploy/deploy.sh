#!/bin/bash

# ================= 配置区域 =================
# 项目配置
SERVICE_NAME="doouyin"
REMOTE_PORT=1007
IMAGE_NAME="registry.cn-hangzhou.aliyuncs.com/vyibc/${SERVICE_NAME}:latest"

# 加载 .env 环境变量
if [ -f .env ]; then
    # 自动导出 .env 中的变量
    export $(grep -v '^#' .env | xargs)
else
    echo "⚠️ Warning: .env file not found. Using default/environment variables."
fi

# 阿里云镜像仓库凭证 (优先使用 .env 中的配置)
DOCKER_USERNAME="${DOCKER_USERNAME:-}"
DOCKER_PASSWORD="${DOCKER_PASSWORD:-}"
DOCKER_REGISTRY="${DOCKER_REGISTRY:-registry.cn-hangzhou.aliyuncs.com}"

# 远程服务器配置 (优先使用 .env 中的配置)
REMOTE_HOST="${REMOTE_HOST:-}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PASSWORD="${REMOTE_PASSWORD:-}"
REMOTE_DIR="${REMOTE_DIR:-/root/projects/_managed/${SERVICE_NAME}}"

# 检查必要配置是否存在
if [[ -z "$DOCKER_USERNAME" || -z "$DOCKER_PASSWORD" || -z "$REMOTE_HOST" || -z "$REMOTE_PASSWORD" ]]; then
    echo "❌ Error: Missing required configuration in .env or environment variables."
    echo "Please set DOCKER_USERNAME, DOCKER_PASSWORD, REMOTE_HOST, and REMOTE_PASSWORD."
    exit 1
fi

# 控制开关
DO_BUILD=true           # 是否构建镜像
DO_PUSH=true            # 是否推送镜像
DO_DEPLOY=true          # 是否执行远程部署

# ================= 脚本逻辑 =================

# 1. 构建镜像
if [ "$DO_BUILD" = true ]; then
    echo "🏗  Starting build for $SERVICE_NAME..."
    
    # 检查是否在项目根目录
    if [ ! -f "package.json" ]; then
        echo "❌ Error: Please run this script from the project root directory."
        exit 1
    fi

    # 使用 deploy/Dockerfile 构建
    docker build -f deploy/Dockerfile -t "$SERVICE_NAME:latest" .
    
    # 打标签
    docker tag "$SERVICE_NAME:latest" "$IMAGE_NAME"
    
    echo "✅ Build completed."
fi

# 2. 推送镜像
if [ "$DO_PUSH" = true ]; then
    echo "📤 Pushing image to registry..."
    
    # 登录阿里云
    echo "$DOCKER_PASSWORD" | docker login --username "$DOCKER_USERNAME" --password-stdin "$DOCKER_REGISTRY"
    
    # 推送
    docker push "$IMAGE_NAME"
    
    echo "✅ Push completed: $IMAGE_NAME"
fi

# 3. 远程部署
if [ "$DO_DEPLOY" = true ]; then
    echo "🚀 Deploying to $REMOTE_HOST..."

    # 生成远程运行脚本
    cat > deploy_remote.sh <<EOF
#!/bin/bash
set -e

# 登录 Docker
echo "$DOCKER_PASSWORD" | docker login --username "$DOCKER_USERNAME" --password-stdin "$DOCKER_REGISTRY"

# 拉取最新镜像
docker pull "$IMAGE_NAME"

# 停止并删除旧容器
if [ "\$(docker ps -aq -f name=$SERVICE_NAME)" ]; then
    echo "Stopping existing container..."
    docker stop $SERVICE_NAME
    docker rm $SERVICE_NAME
fi

# 启动新容器
echo "Starting container..."
docker run -d \\
  --name $SERVICE_NAME \\
  --restart unless-stopped \\
  -p $REMOTE_PORT:1007 \\
  -e OSS_REGION="$OSS_REGION" \\
  -e OSS_ACCESS_KEY_ID="$OSS_ACCESS_KEY_ID" \\
  -e OSS_ACCESS_KEY_SECRET="$OSS_ACCESS_KEY_SECRET" \\
  -e OSS_BUCKET="$OSS_BUCKET" \\
  -v ${REMOTE_DIR}/.douyin-cookie.json:/app/.douyin-cookie.json \\
  "$IMAGE_NAME"

# 清理旧镜像
docker image prune -f

echo "✅ Service deployed successfully on port $REMOTE_PORT"
EOF

    # 确保远程目录存在
    sshpass -p "$REMOTE_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE_USER@$REMOTE_HOST" "mkdir -p $REMOTE_DIR"

    # 上传部署脚本
    sshpass -p "$REMOTE_PASSWORD" scp -o StrictHostKeyChecking=no deploy_remote.sh "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/deploy.sh"

    # 执行部署
    sshpass -p "$REMOTE_PASSWORD" ssh -o StrictHostKeyChecking=no "$REMOTE_USER@$REMOTE_HOST" "bash $REMOTE_DIR/deploy.sh"

    # 清理本地临时文件
    rm deploy_remote.sh
    
    echo "🎉 Deployment finished!"
fi
