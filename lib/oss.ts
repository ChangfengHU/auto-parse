import OSS from 'ali-oss';
import axios from 'axios';
import fs from 'fs';
import { Readable } from 'stream';
import path from 'path';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

/** 默认走 HTTPS（与 ali-oss 默认 secure:false 不同，避免 PUT 落在 http:// 上易被代理/链路掐断） */
function createClient() {
  const useHttps = process.env.OSS_USE_HTTP !== '1' && process.env.OSS_USE_HTTP !== 'true';
  return new OSS({
    region: process.env.OSS_REGION ?? 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
    timeout: 600000, // 10分钟超时，支持大文件上传
    secure: useHttps,
  });
}

function isRetryableOssError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /socket hang up|ECONNRESET|ETIMEDOUT|EPIPE|ECONNABORTED|timed out|Timeout|UND_ERR_SOCKET|ENOTFOUND|EAI_AGAIN/i.test(
    msg
  );
}

/** 工作流批量跑时易出现瞬时断连，与页面单次 debug 体感不一致；对可恢复错误重试 */
type OssClient = InstanceType<typeof OSS>;

async function withOssUploadRetries<T>(label: string, fn: (client: OssClient) => Promise<T>): Promise<T> {
  const raw = process.env.OSS_UPLOAD_RETRIES;
  const max = raw !== undefined && /^\d+$/.test(raw) ? Math.min(8, Math.max(1, Number(raw))) : 3;
  let last: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const client = createClient();
      return await fn(client);
    } catch (e) {
      last = e;
      if (!isRetryableOssError(e) || attempt === max) {
        throw e;
      }
      const delay = 400 * attempt;
      console.warn(
        `[oss] ${label} 第 ${attempt}/${max} 次失败，${delay}ms 后重试:`,
        e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw last;
}

// 从 URL 流式上传（支持大文件，避免内存占用）
export async function uploadVideoFromUrl(videoUrl: string, key: string): Promise<string> {
  return withOssUploadRetries('uploadVideoFromUrl', async (client) => {
    const isXhs = videoUrl.includes('xhscdn.com') || videoUrl.includes('xiaohongshu.com');
    const response = await axios.get(videoUrl, {
      responseType: 'stream',
      timeout: 600000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: isXhs ? 'https://www.xiaohongshu.com/' : 'https://www.douyin.com/',
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

    const url: string = (result as any).url ?? '';
    return url.replace(/^http:\/\//, 'https://');
  });
}

// 小红书图片专用上传方法：先下载到本地，再上传OSS
export async function uploadXhsImageFromUrl(url: string, key: string, cookies?: string): Promise<string> {
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
    const httpsUrl = await withOssUploadRetries('uploadXhsImageFromUrl', async (client) => {
      const filename = key.split('/').pop() ?? 'image.jpg';
      const result = await client.put(key, tempFilePath, {
        headers: {
          'Content-Type': 'image/jpeg',
          'x-oss-object-acl': 'public-read',
          'Content-Disposition': `inline; filename="${filename}"`,
        },
      } as any);

      const u: string = (result as any).url ?? '';
      return u.replace(/^http:\/\//, 'https://');
    });
    console.log(`✅ 图片上传OSS成功: ${httpsUrl}`);
    return httpsUrl;
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

  const ct = inferredContentType;

  return withOssUploadRetries('uploadFromUrl', async (client) => {
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 600000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible)',
        Referer: 'https://www.xiaohongshu.com/',
      },
    });

    const stream = response.data as Readable;
    const filename = key.split('/').pop() ?? 'file';

    const result = await client.putStream(key, stream, {
      headers: {
        'Content-Type': ct,
        'x-oss-object-acl': 'public-read',
        'Content-Disposition': `inline; filename="${filename}"`,
      },
    } as any);

    const urlFromUrl: string = (result as any).url ?? '';
    return urlFromUrl.replace(/^http:\/\//, 'https://');
  });
}

// 从 Buffer 上传
export async function uploadBuffer(buffer: Buffer, key: string, contentType: string = 'image/jpeg'): Promise<string> {
  return withOssUploadRetries('uploadBuffer', async (client) => {
    const filename = key.split('/').pop() ?? 'file';

    const result = await client.put(key, buffer, {
      headers: {
        'Content-Type': contentType,
        'x-oss-object-acl': 'public-read',
        'Content-Disposition': `inline; filename="${filename}"`,
      },
    } as any);

    const url: string = (result as any).url ?? '';
    return url.replace(/^http:\/\//, 'https://');
  });
}

// 从本地 file 上传
export async function uploadFromFile(filePath: string, key: string, contentType: string = 'video/mp4'): Promise<string> {
  return withOssUploadRetries('uploadFromFile', async (client) => {
    const filename = key.split('/').pop() ?? 'file';

    const result = await client.put(key, filePath, {
      headers: {
        'Content-Type': contentType,
        'x-oss-object-acl': 'public-read',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    } as any);

    const urlFromFile: string = (result as any).url ?? '';
    return urlFromFile.replace(/^http:\/\//, 'https://');
  });
}