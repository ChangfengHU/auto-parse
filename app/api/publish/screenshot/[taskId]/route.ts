import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const HISTORY_DIR = path.join(process.cwd(), '.publish-history');

// GET /api/publish/screenshot/[taskId]/screenshots/01-login-check.png
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  // 从 URL 获取文件相对路径（taskId 之后的部分）
  const url = req.nextUrl.pathname;
  const prefix = `/api/publish/screenshot/${taskId}/`;
  const relativePath = url.slice(prefix.length);

  if (!relativePath || relativePath.includes('..')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const filePath = path.join(HISTORY_DIR, taskId, relativePath);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const buf = fs.readFileSync(filePath);
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
