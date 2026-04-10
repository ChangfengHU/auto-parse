---
name: vyibc-ads-profile-sync
description: 复制 AdsPower 分身登录态与代理配置到其它分身（支持批量传播）。
---

## 用途

把一个“母版分身”的状态批量复制到其它实例：

1. 复制登录态（Cookies/LocalStorage/会话缓存）
2. 复制代理配置（`user_proxy_config`）
3. 可选自动重启目标分身并验证状态

## 脚本

```bash
# 全量复制（登录态 + 代理）
bash skills/vyibc-ads-profile-sync/scripts/sync-state.sh \
  --source-id k1b908rw \
  --targets k1b8yqxe,k1ba8vac

# 仅复制登录态
bash skills/vyibc-ads-profile-sync/scripts/sync-state.sh \
  --source-id k1b908rw \
  --targets k1b8yqxe,k1ba8vac \
  --copy-proxy 0

# 仅复制代理配置
bash skills/vyibc-ads-profile-sync/scripts/sync-state.sh \
  --source-id k1b8yqxe \
  --targets k1b908rw,k1ba8vac \
  --copy-login 0

# 强制下发“美国代理”到多个实例（不依赖source代理）
bash skills/vyibc-ads-profile-sync/scripts/sync-state.sh \
  --source-id k1b8yqxe \
  --targets k1b908rw,k1ba8vac \
  --copy-login 0 \
  --copy-proxy 1 \
  --proxy-host <your-us-proxy-host> \
  --proxy-port <your-us-proxy-port> \
  --proxy-user <your-us-proxy-user> \
  --proxy-password <your-us-proxy-password> \
  --start-after 1 \
  --verify-ip 1
```

## 默认参数

- Ads API：`http://127.0.0.1:50325`
- 启动参数：`["--no-sandbox","--disable-dev-shm-usage"]`
