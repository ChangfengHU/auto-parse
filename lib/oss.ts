import OSS from 'ali-oss';
import axios from 'axios';

function createClient() {
  return new OSS({
    region: process.env.OSS_REGION ?? 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
  });
}

export async function uploadVideoFromUrl(videoUrl: string, key: string): Promise<string> {
  const client = createClient();

  // 下载视频到 Buffer（抖音短视频通常 < 50MB）
  const response = await axios.get(videoUrl, {
    responseType: 'arraybuffer',
    timeout: 180000, // 3 分钟
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible)',
      Referer: 'https://www.douyin.com/',
    },
  });

  const buffer = Buffer.from(response.data as ArrayBuffer);
  const result = await client.put(key, buffer, {
    headers: {
      'Content-Type': 'video/mp4',
      'x-oss-object-acl': 'public-read',
    },
  });

  return result.url;
}
