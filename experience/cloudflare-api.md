# Cloudflare API 使用经验

## CF API Key 认证格式（血泪教训）

### 问题
使用 `cfk_` 开头的 Global API Key 时，用 `Authorization: Bearer <token>` 会报 `Invalid access token` 错误。

### 根因
CF API 有两种认证方式，**不可混用**：

| Token 类型 | 前缀 | 正确头部 |
|-----------|------|---------|
| API Token（权限受限）| `cfk_` 或无特殊前缀（但从 API Token 页面创建） | `Authorization: Bearer <token>` |
| Global API Key（最高权限）| 无前缀，纯 hex 字符串，从 My Profile > API Keys 获取 | `X-Auth-Key: <key>` + `X-Auth-Email: <email>` |

**实际踩坑**：用户提供的密钥是从 "API Keys" 页面拿的 Global API Key，必须用以下方式：

```bash
curl -X POST "https://api.cloudflare.com/client/v4/..." \
  -H "X-Auth-Key: <your-global-api-key>" \
  -H "X-Auth-Email: <your-cf-account-email>" \
  -H "Content-Type: application/json"
```

**错误方式（不要用）**：
```bash
# 这种方式对 Global API Key 无效！
curl -H "Authorization: Bearer <global-api-key>" ...
```

### 验证方法
先用这个命令验证 key 是否有效：
```bash
curl -s "https://api.cloudflare.com/client/v4/user" \
  -H "X-Auth-Key: <key>" \
  -H "X-Auth-Email: <email>" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success'), d.get('result',{}).get('email',''))"
```
返回 `True <email>` 即为正确。

---

## Cloudflare Tunnel 创建流程（API 方式）

用于在没有 GUI 的情况下纯 API 创建 tunnel + ingress + DNS。

### 1. 获取 Account ID
```bash
curl -s "https://api.cloudflare.com/client/v4/accounts" \
  -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(a['id'], a['name']) for a in d.get('result',[])]"
```

### 2. 创建 Tunnel
```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel" \
  -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" \
  -H "Content-Type: application/json" \
  -d '{"name":"tunnel-name","tunnel_secret":"<base64-32bytes>"}'
```
返回 `result.id` 即为 TUNNEL_ID，`result.token` 为 cloudflared 启动用的 token。

### 3. 配置 Ingress
```bash
curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" \
  -H "Content-Type: application/json" \
  -d '{"config":{"ingress":[{"hostname":"sub.domain.com","service":"http://localhost:PORT"},{"service":"http_status:404"}]}}'
```

### 4. 创建 DNS CNAME
先获取 Zone ID：
```bash
curl -s "https://api.cloudflare.com/client/v4/zones?name=domain.com" \
  -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result'][0]['id'])"
```
再创建记录：
```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"CNAME\",\"name\":\"sub\",\"content\":\"$TUNNEL_ID.cfargotunnel.com\",\"proxied\":true}"
```

### 5. 启动 cloudflared
```bash
cloudflared tunnel run --token <tunnel-token> &
```
或用 systemd service（推荐）。

---

## 凭证存放位置

CF 相关凭证存放在 `~/.secrets/`:
- `~/.secrets/cf-api-key` — Global API Key
- `~/.secrets/cf-account-email` — CF 账号邮箱
- `~/.secrets/cf-account-id` — Account ID
- `~/.secrets/cloudflared-*-token` — 各 tunnel 的 token

**不要在代码或聊天里输出明文凭证。**
