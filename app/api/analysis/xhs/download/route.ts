/**
 * GET  /api/analysis/xhs/download?url=xxx  — 单图代理下载（触发浏览器 download）
 * POST /api/analysis/xhs/download          — 批量下载
 *   body: { urls, mode: 'local'|'oss', ossPrefix? }
 *   local → 返回 base64 文件列表
 *   oss   → 上传到 OSS，返回 ossUrls
 */

import { NextResponse } from 'next/server';
import { downloadImageBuffer } from '@/lib/analysis/xhs-fetch';
import { uploadBuffer } from '@/lib/oss';

// ── GET：单文件代理（供 <a download> href 使用）────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  try {
    const buffer = await downloadImageBuffer(url);
    const ext = url.includes('.png') ? 'png' : url.includes('.webp') ? 'webp' : 'jpg';
    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': `image/${ext}`,
        'Content-Disposition': `attachment; filename="xhs_${Date.now()}.${ext}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── POST：批量下载 ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { urls, mode, ossPrefix = 'xhs' } = await req.json() as {
    urls: string[];
    mode: 'local' | 'oss';
    ossPrefix?: string;
  };

  if (!urls?.length) {
    return NextResponse.json({ error: 'urls 不能为空' }, { status: 400 });
  }

  const batchId = Date.now().toString(36);

  if (mode === 'oss') {
    const ossUrls: string[] = [];
    const errors: string[] = [];
    for (let i = 0; i < urls.length; i++) {
      try {
        const buffer = await downloadImageBuffer(urls[i]);
        const ext = urls[i].includes('.png') ? 'png' : 'jpg';
        const ossPath = `${ossPrefix}/${batchId}_${String(i + 1).padStart(2, '0')}.${ext}`;
        const ossUrl = await uploadBuffer(buffer, ossPath, `image/${ext}`);
        ossUrls.push(ossUrl);
      } catch (e) {
        errors.push(`第 ${i + 1} 张：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return NextResponse.json({ ok: true, ossUrls, errors });
  }

  // local mode：返回 base64，前端逐个触发下载
  const files: { filename: string; dataUrl: string }[] = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      const buffer = await downloadImageBuffer(urls[i]);
      const ext = urls[i].includes('.png') ? 'png' : 'jpg';
      files.push({
        filename: `xhs_${batchId}_${String(i + 1).padStart(2, '0')}.${ext}`,
        dataUrl: `data:image/${ext};base64,${buffer.toString('base64')}`,
      });
    } catch {
      files.push({ filename: `error_${i + 1}`, dataUrl: '' });
    }
  }
  return NextResponse.json({ ok: true, files });
}
