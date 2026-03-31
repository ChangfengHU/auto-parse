import OSS from 'ali-oss';
import axios from 'axios';
import fs from 'fs';
import { Readable } from 'stream';
import path from 'path';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

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

// 小红书图片专用上传方法：先下载到本地，再上传OSS
export async function uploadXhsImageFromUrl(url: string, key: string, cookies?: string): Promise<string> {
  const client = createClient();
  
  // 创建临时目录
  const tempDir = path.join(process.cwd(), 'temp');
  try {
    await mkdir(tempDir, { recursive: true });
  } catch (error) {
    // 目录已存在，忽略错误
  }

  const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
  const tempFilePath = path.join(tempDir, tempFileName);

  // 尝试多种配置下载图片到本地
  const configs = [
    // 配置1：使用提供的cookie
    ...(cookies ? [{
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/avif,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Referer': 'https://www.xiaohongshu.com/',
        'Cookie': cookies,
      },
    }] : []),
    // 配置2：模仿移动端
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Accept': 'image/*',
        'Referer': 'https://www.xiaohongshu.com/',
      },
    },
    // 配置3：简单请求
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible)',
        'Referer': 'https://www.xiaohongshu.com/',
      },
    },
    // 配置4：无Referer
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible)',
      },
    },
  ];

  let downloadSuccess = false;
  let lastError: any = null;

  // 尝试下载图片到本地
  for (const config of configs) {
    try {
      console.log(`尝试下载配置: ${JSON.stringify(config.headers)}`);
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000, // 1分钟超时
        ...config,
      });

      await writeFile(tempFilePath, response.data);
      console.log(`✅ 图片下载成功: ${tempFilePath}`);
      downloadSuccess = true;
      break;
    } catch (error) {
      lastError = error;
      console.log(`配置失败，尝试下一个: ${error}`);
    }
  }

  if (!downloadSuccess) {
    throw lastError || new Error('所有下载配置都失败了');
  }

  try {
    // 从本地文件上传到OSS
    const filename = key.split('/').pop() ?? 'image.jpg';
    const result = await client.put(key, tempFilePath, {
      headers: {
        'Content-Type': 'image/jpeg',
        'x-oss-object-acl': 'public-read',
        'Content-Disposition': `inline; filename="${filename}"`,
      },
    } as any);

    console.log(`✅ 图片上传OSS成功: ${(result as any).url}`);
    return (result as any).url;
  } finally {
    // 清理临时文件
    try {
      await unlink(tempFilePath);
      console.log(`🗑️ 临时文件已清理: ${tempFilePath}`);
    } catch (error) {
      console.warn(`清理临时文件失败: ${error}`);
    }
  }
}

// 从 URL 上传图片或其他文件（通用方法）
export async function uploadFromUrl(url: string, key: string, contentType?: string): Promise<string> {
  const client = createClient();

  // 根据文件扩展名推断 Content-Type
  const ext = key.split('.').pop()?.toLowerCase();
  let inferredContentType = contentType;
  
  if (!inferredContentType) {
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        inferredContentType = 'image/jpeg';
        break;
      case 'png':
        inferredContentType = 'image/png';
        break;
      case 'webp':
        inferredContentType = 'image/webp';
        break;
      case 'gif':
        inferredContentType = 'image/gif';
        break;
      case 'mp4':
        inferredContentType = 'video/mp4';
        break;
      default:
        inferredContentType = 'application/octet-stream';
    }
  }

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 600000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible)',
      'Referer': 'https://www.xiaohongshu.com/',
    },
  });

  const stream = response.data as Readable;
  const filename = key.split('/').pop() ?? 'file';
  
  const result = await client.putStream(key, stream, {
    headers: {
      'Content-Type': inferredContentType,
      'x-oss-object-acl': 'public-read',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  } as any);

  return (result as any).url;
}

// 从 Buffer 上传
export async function uploadBuffer(buffer: Buffer, key: string, contentType: string = 'image/jpeg'): Promise<string> {
  const client = createClient();
  const filename = key.split('/').pop() ?? 'file';

  const result = await client.put(key, buffer, {
    headers: {
      'Content-Type': contentType,
      'x-oss-object-acl': 'public-read',
      'Content-Disposition': `inline; filename="${filename}"`,
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
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  } as any);

  return (result as any).url;
}