# Video Channel Profile Resolution

## Primary: Local Yuanbao CDP Session

The production parser uses the visible browser on the same host. The default
CDP endpoint is `http://127.0.0.1:9222`; override it with
`YUANBAO_CDP_URL` only when the browser contract changes.

The browser profile owns the Yuanbao session. The parser captures current
device request headers in memory and never serializes Cookie or header values.
Renew an expired session through the host's VNC page. A Cookie file or future
expiry timestamp is not proof of authorization: the Yuanbao parse request must
return HTTP 200 and a playable URL.

## Secondary: External Profile API

- Open-source project: https://github.com/ltaoo/wx_channels_download
- Public service: https://sph.litao.workers.dev/
- Endpoint: `POST https://sph.litao.workers.dev/api/fetch_video_profile`

The endpoint is an external dependency and is not owned by this project. Its
maintainer's Yuanbao session can expire without notice. Validate it before
relying on it and use `WECHAT_CHANNELS_PROFILE_API_URL` to replace it without
changing application code.

## Request

```json
{ "url": "https://weixin.qq.com/sph/<share-id>" }
```

## Required Response Fields

```txt
data.feedInfo.h264VideoInfo.videoUrl
data.feedInfo.h265VideoInfo.videoUrl
data.feedInfo.videoUrl
data.feedInfo.coverUrl
data.authorInfo.nickname
```

Select the first non-empty video URL in the listed order. The source video URL is short-lived; `app/api/parse/route.ts` must upload it to R2 and return `ossUrl` for the mini-program.

## Production Ownership

| Component | Location | Responsibility |
| --- | --- | --- |
| Parser fallback | `auto-parse/lib/parsers/wechat-playwright.ts` | Resolve profile data and source video URL |
| Public API | `https://auto-parse-v2.vyibc.com/api/parse` | Upload video and cover data to R2 |
| Mini-program worker | `cloudflare-youtube-pipeline/suqu-api/wrangler.toml` | `PARSE_250_URL` points to auto-parse |

## Failure Procedure

1. Check that CDP exposes a Yuanbao page and test the local session with one
   current public share link.
2. If Yuanbao returns 401, renew the self-owned login through VNC. Do not use
   public Cookies, leaked accounts, or scraped credentials.
3. If the local path is unavailable, run `scripts/check-profile-api.mjs` against
   the external fallback and at least three current share links.
4. Test any replacement independently, set `WECHAT_CHANNELS_PROFILE_API_URL`,
   then rebuild and restart the service.
5. Confirm `/api/parse` returns an R2 `ossUrl`, the object returns `video/mp4`,
   and `suqu-api-v2` persists a non-empty `video_url`.
