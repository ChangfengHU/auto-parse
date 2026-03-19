# 视频解析 API 文档

> 服务地址：**https://parse.vyibc.com**

---

## 接口列表

| 接口 | 说明 | 耗时 |
|------|------|------|
| `POST /api/parse` + `watermark:false` | 抖音无水印解析 + OSS上传 | ~25s |
| `POST /api/parse` + `watermark:true`  | 抖音有水印解析 + OSS上传 | ~3s  |
| `POST /api/parse` (小红书链接)         | 小红书视频解析 + OSS上传 | ~5s  |

---

## POST /api/parse

统一解析接口，自动识别平台。

### 请求

**Headers**

```
Content-Type: application/json
```

**Body**

```json
{
  "url": "分享链接或包含链接的文本",
  "watermark": false
}
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string | ✅ | — | 分享链接，支持带前后文字的完整分享文本 |
| `watermark` | boolean | ❌ | `false` | 仅对抖音生效。`false`=无水印(慢)，`true`=有水印(快) |

### 响应

**成功 200**

```json
{
  "success": true,
  "platform": "douyin",
  "videoId": "7590273602331816806",
  "title": "2026已到站💃#新年有礼了 #2026启动仪式",
  "videoUrl": "https://v5-dy-o-abtest.zjcdn.com/xxx/video/tos/...",
  "ossUrl": "https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/7590273602331816806.mp4",
  "watermark": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 是否成功 |
| `platform` | string | 平台：`douyin` / `xiaohongshu` |
| `videoId` | string | 平台内的视频唯一 ID |
| `title` | string | 视频标题/文案 |
| `videoUrl` | string | 原始 CDN 地址（有效期短，建议用 ossUrl） |
| `ossUrl` | string | OSS 永久地址（公开可访问） |
| `watermark` | boolean | `false`=无水印，`true`=有水印 |

**失败 400 / 500**

```json
{
  "error": "错误描述"
}
```

---

## 使用示例

### 抖音 · 无水印（推荐）

```bash
curl -X POST https://parse.vyibc.com/api/parse \
  -H "Content-Type: application/json" \
  -d '{
    "url": "9.43 B@T.yt 05/19 VYm:/ 心怎么变 都是偏向你 https://v.douyin.com/m7Tw65kygH8/",
    "watermark": false
  }'
```

### 抖音 · 有水印（快速）

```bash
curl -X POST https://parse.vyibc.com/api/parse \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://v.douyin.com/m7Tw65kygH8/",
    "watermark": true
  }'
```

### 小红书

```bash
curl -X POST https://parse.vyibc.com/api/parse \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.xiaohongshu.com/explore/6993fd3e000000002800bc9c?xsec_token=xxx"
  }'
```

### JavaScript / Fetch

```javascript
const res = await fetch('https://parse.vyibc.com/api/parse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://v.douyin.com/m7Tw65kygH8/',
    watermark: false   // true = 有水印快速模式
  })
});
const data = await res.json();
// data.ossUrl  → 永久 OSS 地址
// data.videoUrl → 原始 CDN 地址
```

### Python

```python
import requests

resp = requests.post(
    'https://parse.vyibc.com/api/parse',
    json={
        'url': 'https://v.douyin.com/m7Tw65kygH8/',
        'watermark': False
    }
)
data = resp.json()
print(data['ossUrl'])   # OSS 永久地址
```

---

## 错误码说明

| HTTP 状态 | error 内容 | 原因 |
|-----------|-----------|------|
| 400 | 请提供分享链接 | url 为空 |
| 400 | 暂不支持该平台 | 不是抖音/小红书链接 |
| 400 | 未找到有效的抖音分享链接 | 链接格式不对 |
| 500 | 短链解析失败 | 抖音短链失效 |
| 500 | Playwright 超时 | 网络慢或 Cookie 过期 |
| 500 | 页面中未找到视频地址 | 视频已删除或需登录 |

---

## 注意事项

1. **抖音无水印模式**需要服务端配置有效的登录 Cookie，Cookie 过期后自动降级为有水印模式
2. **OSS 地址**为永久公开地址，推荐优先使用
3. **小红书**固定无水印，无需 Cookie
4. 接口无鉴权，建议部署时自行加上 IP 白名单或 Token
