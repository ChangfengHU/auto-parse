import { NextRequest, NextResponse } from 'next/server';
import { publishDocPage } from '@/lib/doc-page-publisher';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await publishDocPage({
      title: typeof body.title === 'string' ? body.title : undefined,
      content: typeof body.content === 'string' ? body.content : undefined,
      filePath: typeof body.filePath === 'string' ? body.filePath : undefined,
      folder: typeof body.folder === 'string' ? body.folder : undefined,
      objectKey: typeof body.objectKey === 'string' ? body.objectKey : undefined,
      provider: body.provider === 'oss' ? 'oss' : 'doc-to-page',
    });
    return NextResponse.json({
      success: true,
      ...result,
      previewUrl: result.key ? `/api/docs/preview?key=${encodeURIComponent(result.key)}` : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
