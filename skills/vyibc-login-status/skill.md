---
name: vyibc-login-status
description: 查询抖音账号的登录状态。当用户说"查一下登录状态"、"我登录了吗"、"凭证还有效吗"、"dy_xxx 登录了没"、"检查一下抖音是否在线"时触发。
---

## 执行命令

```bash
bash scripts/check-login.sh "<clientId>"
```

示例：
```bash
bash scripts/check-login.sh "dy_cf8b7ec6f2424b7db449f2d7ecf20ae9"
```

> 服务地址默认 `https://parse.vyibc.com`，可通过环境变量 `VYIBC_BASE_URL` 覆盖。

## 参数提取规则

| 参数 | 来源 |
|------|------|
| clientId | 用户消息中 `dy_` 开头的字符串；若未提供则询问用户 |

**只要用户消息中出现 `dy_` 开头的字符串，必须识别为 clientId。**

## 输出解读

脚本最后一行输出 `LOGIN_STATUS=ok` 或 `LOGIN_STATUS=not_logged_in`：

| 输出 | 含义 | 回复用户 |
|------|------|----------|
| `LOGIN_STATUS=ok` | 已登录，session 有效 | "✅ 抖音已登录，可以正常发布" |
| `LOGIN_STATUS=not_logged_in` | 未登录或 session 失效 | "❌ 抖音未登录，请打开抖音网页重新登录，插件会自动同步" |

## 接口说明（供参考）

直接调用接口：
```
GET https://parse.vyibc.com/api/login/status?clientId=dy_xxx
```

响应示例（已登录）：
```json
{
  "loggedIn": true,
  "clientId": "dy_xxx",
  "account": "用户名",
  "updatedAt": "2026-03-23T04:20:00Z",
  "message": "已登录（已验证），账号：用户名，0 小时前同步"
}
```

响应示例（未登录）：
```json
{
  "loggedIn": false,
  "clientId": "dy_xxx",
  "message": "Session 已失效，请重新登录抖音后插件会自动同步"
}
```
