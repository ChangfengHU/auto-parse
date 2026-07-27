#!/usr/bin/env node

const inputUrl = process.argv[2];
const endpoint = process.env.WECHAT_CHANNELS_PROFILE_API_URL
  || 'https://sph.litao.workers.dev/api/fetch_video_profile';

if (!inputUrl) {
  console.error('Usage: check-profile-api.mjs <weixin.qq.com/sph share URL>');
  process.exit(2);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 25_000);

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: inputUrl }),
    signal: controller.signal,
  });
  const body = await response.json().catch(() => ({}));
  const feedInfo = body?.data?.feedInfo || {};
  const videoUrl = feedInfo?.h264VideoInfo?.videoUrl
    || feedInfo?.h265VideoInfo?.videoUrl
    || feedInfo?.videoUrl
    || '';
  const result = {
    endpoint,
    httpStatus: response.status,
    errCode: body?.errCode ?? null,
    errMsg: body?.errMsg || null,
    hasVideo: Boolean(videoUrl),
    hasCover: Boolean(feedInfo?.coverUrl),
    author: body?.data?.authorInfo?.nickname || null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok || !videoUrl) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ endpoint, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
