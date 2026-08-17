---
name: vyibc-wechat-channels-parser
description: Restore, validate, and maintain WeChat Channels parsing in auto-parse and the Suqu mini-program. Use when a `weixin.qq.com/sph/` or `channels.weixin.qq.com` link lacks a video stream, returns a profile API error, or the fallback endpoint needs replacement.
---

# WeChat Channels Parser

Use the self-owned Yuanbao browser session on the parser host as the primary
video-profile path. Keep credentials inside the persistent browser profile;
never copy cookies into source, logs, task results, or Skill output. The public
profile API documented in `references/profile-api.md` is only a secondary
fallback.

## Runtime Path

1. `lib/parsers/wechat-playwright.ts` loads public page metadata and first attempts the page's feed API.
2. If no `videoUrl` is found, it connects to `YUANBAO_CDP_URL` (default
   `http://127.0.0.1:9222`), reuses the logged-in Yuanbao page, and captures the
   current device request headers without exposing their values.
3. Yuanbao resolves the share URL to an export ID and general token; the parser
   calls the Channels feed API to obtain the source video.
4. If the local session fails, the parser calls `WECHAT_CHANNELS_PROFILE_API_URL`,
   defaulting to `https://sph.litao.workers.dev/api/fetch_video_profile`.
5. `app/api/parse/route.ts` uploads the short-lived source video to R2 and returns
   `ossUrl`.
6. `suqu-api-v2` persists the R2 URL through its normal task/work flow.

A successful parse requires `videoUrl` and, for the full API, `ossUrl`. A task
marked `done` with only cover metadata is a failure.

## Validate

Confirm the CDP browser and Yuanbao page exist before changing code:

```bash
curl -fsS http://127.0.0.1:9222/json/list | jq -e \
  '.[] | select(.url | contains("yuanbao.tencent.com"))'
```

Then run one end-to-end `POST /api/parse` test. Accept only a `200` response with
a public `ossUrl`; verify the object returns `video/mp4` and the corresponding
`suqu-api-v2` work has a non-empty `video_url`.

## Repair

Read `references/profile-api.md` before changing the fallback. If the local path
returns HTTP 401, open Yuanbao in the parser host's visible VNC browser and renew
the login there. Keep the Yuanbao tab open, rebuild and restart
`auto-parse.service`, then repeat the end-to-end R2 test. Only investigate
`WECHAT_CHANNELS_PROFILE_API_URL` after the self-owned path has failed. Commit
and push code and Skill changes together.
