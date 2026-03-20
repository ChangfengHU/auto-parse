# 抖音/小红书解析服务部署文档

所有部署相关文件均位于 `deploy/` 目录下。

## 目录结构

- `deploy.sh`: **核心脚本**。一键完成构建、推送、远程部署。
- `Dockerfile`: 镜像构建文件。
- `README.md`: 本文档。

## 拆分脚本

为了更灵活地控制流程，您可以分别执行以下脚本：

### 1. 仅构建并推送镜像
```bash
./deploy/build-push.sh
```

### 2. 仅执行远程部署 (拉取并启动)
```bash
./deploy/remote-run.sh
```

这两步合起来的效果等同于直接运行 `./deploy/deploy.sh`。

---

## 配置说明

脚本 `deploy/deploy.sh` 头部包含配置项，可根据需要修改：

```bash
SERVICE_NAME="doouyin"
REMOTE_HOST="152.32.214.95"
# ...
```

## 环境要求

### 本地
- Docker
- `sshpass` (用于脚本自动输入密码，Mac安装: `brew install sshpass`)

### 远程服务器
- Docker 环境
- 目录 `/root/projects/_managed/doouyin` (脚本会自动创建)
