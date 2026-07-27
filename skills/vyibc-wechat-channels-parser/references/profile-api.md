# Video Channel Profile API

## Source

- Open-source project: https://github.com/ltaoo/wx_channels_download
- Public service: https://sph.litao.workers.dev/
- Endpoint: `POST https://sph.litao.workers.dev/api/fetch_video_profile`

The endpoint is an external dependency. It requires no user Cookie or QR login, but it is not owned by this project. Validate it before relying on it and use `WECHAT_CHANNELS_PROFILE_API_URL` to replace it without changing application code.

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
| Public API | `https://auto-parse-65.vyibc.com/api/parse` | Upload video and cover data to R2 |
| Mini-program worker | `cloudflare-youtube-pipeline/suqu-api/wrangler.toml` | `PARSE_250_URL` points to auto-parse |

## Failure Procedure

1. Run `scripts/check-profile-api.mjs` with three recent public video-channel share links.
2. If the endpoint fails, capture HTTP status and error code but do not use public Cookies, leaked accounts, or scraped credentials.
3. Test a replacement endpoint independently, set `WECHAT_CHANNELS_PROFILE_API_URL`, then rebuild and restart the service.
4. Confirm `/api/parse` returns an R2 `ossUrl` and check the object returns `video/mp4`.
