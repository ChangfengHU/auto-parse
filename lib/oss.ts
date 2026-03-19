import OSS from 'ali-oss';
import axios from 'axios';
import fs from 'fs';

function createClient() {
  return new OSS({
    region: process.env.OSS_REGION ?? 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
  });
}

// 从 URL 下载后上传
export async function uploadVideoFromUrl(videoUrl: string, key: string): Promise<string> {
  const client = createClient();

  const response = await axios.get(videoUrl, {
    responseType: 'arraybuffer',
    timeout: 180000,
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

// 从本地文件上传（ffmpeg 合并后用这个）
export async function uploadVideoFromFile(filePath: string, key: string): Promise<string> {
  const client = createClient();

  const stream = fs.createReadStream(filePath);
  const stat = fs.statSync(filePath);

  const result = await client.put(key, stream, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(stat.size),
      'x-oss-object-acl': 'public-read',
    },
  });

  // 上传后删除临时文件
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }

  return result.url;
}
