import axios from 'axios';
import type { ParseR2Config } from '@/lib/parse/types';
import { DEFAULT_R2_CONFIG } from '@/lib/parse/types';

function normalizeR2Config(partial?: Partial<ParseR2Config>): ParseR2Config {
  return {
    uploadUrl: partial?.uploadUrl?.trim() || process.env.R2_UPLOAD_URL?.trim() || DEFAULT_R2_CONFIG.uploadUrl,
    token: partial?.token?.trim() || process.env.R2_UPLOAD_TOKEN?.trim() || DEFAULT_R2_CONFIG.token,
    domain: partial?.domain?.trim() || process.env.R2_PUBLIC_DOMAIN?.trim() || DEFAULT_R2_CONFIG.domain,
    path: partial?.path?.trim() || process.env.R2_UPLOAD_PATH?.trim() || DEFAULT_R2_CONFIG.path,
  };
}

export function buildR2PublicUrl(domain: string, objectPath: string, fileName: string): string {
  const base = domain.replace(/\/+$/, '');
  const dir = objectPath.replace(/^\/+|\/+$/g, '');
  const name = fileName.replace(/^\//, '');
  return dir ? `${base}/${dir}/${name}` : `${base}/${name}`;
}

function parseR2ResponseUrl(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const rec = body as Record<string, unknown>;
  for (const key of ['url', 'publicUrl', 'public_url', 'fileUrl', 'file_url']) {
    const val = rec[key];
    if (typeof val === 'string' && val.startsWith('http')) return val;
  }
  const data = rec.data;
  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>;
    for (const key of ['url', 'publicUrl', 'public_url']) {
      const val = nested[key];
      if (typeof val === 'string' && val.startsWith('http')) return val;
    }
  }
  return fallback;
}

export async function uploadBufferToR2(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  r2Partial?: Partial<ParseR2Config>
): Promise<string> {
  const cfg = normalizeR2Config(r2Partial);
  if (!cfg.uploadUrl || !cfg.token) {
    throw new Error('R2 上传缺少 uploadUrl 或 token');
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), fileName);
  form.append('domain', cfg.domain);
  form.append('name', fileName);
  form.append('path', cfg.path);

  const res = await fetch(cfg.uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 上传失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const fallback = buildR2PublicUrl(cfg.domain, cfg.path, fileName);
  try {
    const json = await res.json();
    return parseR2ResponseUrl(json, fallback);
  } catch {
    return fallback;
  }
}

export async function uploadFileToR2(
  filePath: string,
  fileName: string,
  contentType: string,
  r2Partial?: Partial<ParseR2Config>
): Promise<string> {
  const fs = await import('fs');
  const buffer = await fs.promises.readFile(filePath);
  return uploadBufferToR2(buffer, fileName, contentType, r2Partial);
}

export async function uploadVideoFromUrlToR2(
  videoUrl: string,
  fileName: string,
  r2Partial?: Partial<ParseR2Config>,
  cookieStr?: string
): Promise<string> {
  const isXhs = videoUrl.includes('xhscdn.com') || videoUrl.includes('xiaohongshu.com');
  const response = await axios.get(videoUrl, {
    responseType: 'arraybuffer',
    timeout: 600_000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: isXhs ? 'https://www.xiaohongshu.com/' : 'https://www.douyin.com/',
      ...(cookieStr ? { Cookie: cookieStr } : {}),
    },
  });
  return uploadBufferToR2(Buffer.from(response.data), fileName, 'video/mp4', r2Partial);
}
