import OSS from 'ali-oss';
import axios from 'axios';
import fs from 'fs';
import { Readable } from 'stream';

function createClient() {
  return new OSS({
    region: process.env.OSS_REGION ?? 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
    timeout: 600000,  // 10分钟超时，支持大文件上传
  });
}

// 从 URL 流式上传（支持大文件，避免内存占用）
export async function uploadVideoFromUrl(videoUrl: string, key: string): Promise<string> {
  const client = createClient();

  const response = await axios.get(videoUrl, {
    responseType: 'stream',  // 改为流式传输
    timeout: 600000,  // 10分钟超时
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible)',
      Referer: 'https://www.douyin.com/',
    },
  });

  const stream = response.data as Readable;
  const filename = key.split('/').pop() ?? 'video.mp4';
  
  const result = await client.putStream(key, stream, {
    headers: {
      'Content-Type': 'video/mp4',
      'x-oss-object-acl': 'public-read',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  } as any);

  return (result as any).url;
}

// 从本地 file 上传
export async function uploadFromFile(filePath: string, key: string, contentType: string = 'video/mp4'): Promise<string> {
  const client = createClient();
  const filename = key.split('/').pop() ?? 'file';

  const result = await client.put(key, filePath, {
    headers: {
      'Content-Type': contentType,
      'x-oss-object-acl': 'public-read',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  });

  return (result as any).url;
}

// 从 Buffer 上传（二维码、动态截图等）
export async function uploadBuffer(buf: Buffer, key: string, contentType: string = 'image/png'): Promise<string> {
  const client = createClient();
  const filename = key.split('/').pop() ?? 'image.png';

  const result = await client.put(key, buf, {
    headers: {
      'Content-Type': contentType,
      'x-oss-object-acl': 'public-read',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  });

  return (result as any).url;
}


