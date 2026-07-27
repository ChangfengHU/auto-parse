---
name: vyibc-wechat-channels-parser
description: Restore, validate, and maintain WeChat Channels parsing in auto-parse and the Suqu mini-program. Use when a `weixin.qq.com/sph/` or `channels.weixin.qq.com` link lacks a video stream, returns a profile API error, or the fallback endpoint needs replacement.
---

# WeChat Channels Parser

Keep the video-channel path independent of Yuanbao, QR login, cookies, and third-party credentials. The primary fallback is the public profile API documented in `references/profile-api.md`.

## Runtime Path

1. `lib/parsers/wechat-playwright.ts` loads public page metadata and first attempts the page's feed API.
2. If no `videoUrl` is found, it calls `WECHAT_CHANNELS_PROFILE_API_URL`, defaulting to `https://sph.litao.workers.dev/api/fetch_video_profile`.
3. `app/api/parse/route.ts` uploads the resolved source video to R2 and returns `ossUrl`.
4. `suqu-api` already calls `https://auto-parse-65.vyibc.com/api/parse`; the mini-program receives the persisted R2 URL through its normal task/work flow.

Do not insert Yuanbao session or login state into this path. A successful parse is determined by `videoUrl` and, for the full API, `ossUrl`; do not treat unrelated diagnostic text as a fatal error.

## Validate

Run the profile check before changing code:

```bash
node skills/vyibc-wechat-channels-parser/scripts/check-profile-api.mjs \
  'https://weixin.qq.com/sph/Ac5aKZZObK'
```

Then run one end-to-end `POST /api/parse` test on the production host. Accept only a `200` response with a public `ossUrl`; verify the URL returns `video/mp4`.

## Repair

Read `references/profile-api.md` before changing the fallback. If the default endpoint fails, first test it with the script against at least three current share links. Configure a verified replacement through `WECHAT_CHANNELS_PROFILE_API_URL` in `/etc/auto-parse-65.env`, rebuild, restart `auto-parse-65.service`, and repeat the end-to-end R2 test. Commit and push code and Skill changes together.
