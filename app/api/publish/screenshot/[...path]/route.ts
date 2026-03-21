import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const HISTORY_DIR = path.join(process.cwd(), '.publish-history');

/**
 * GET /api/publish/screenshot/{taskId}/screenshots/{filename}
 * GET /api/publish/screenshot/{taskId}/screenshots/qrcode-{timestamp}.png
 *
 * 使用 catch-all [...path] 路由，支持任意层级子路径。
 * params.path = ['taskId', 'screenshots', 'filename.png']
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  if (!segments || segments.length < 2) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const [taskId, ...rest] = segments;
  const relativePath = rest.join('/');

  // 防止路径穿越
  if (!taskId || !relativePath || relativePath.includes('..')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const filePath = path.join(HISTORY_DIR, taskId, relativePath);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';

  return new NextResponse(buf, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
