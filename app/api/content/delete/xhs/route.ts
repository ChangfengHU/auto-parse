import { NextRequest, NextResponse } from 'next/server';
import { deleteXhsPost } from '@/lib/content-storage-hybrid';

/**
 * DELETE /api/content/delete/xhs
 * 删除小红书内容
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: '缺少作品ID' }, { status: 400 });
    }

    try {
      await deleteXhsPost(id);
      return NextResponse.json({ 
        success: true, 
        message: '作品已删除' 
      });
    } catch (error) {
      return NextResponse.json({ 
        error: '作品不存在或删除失败' 
      }, { status: 404 });
    }

  } catch (error) {
    console.error('删除小红书内容失败:', error);
    return NextResponse.json({ 
      error: `删除失败: ${String(error)}` 
    }, { status: 500 });
  }
}