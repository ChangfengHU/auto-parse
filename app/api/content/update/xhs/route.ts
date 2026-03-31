import { NextRequest, NextResponse } from 'next/server';
import { updateXhsPost } from '@/lib/content-storage';

/**
 * PUT /api/content/update/xhs
 * 更新小红书内容
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    
    if (!body.id) {
      return NextResponse.json({ error: '缺少作品ID' }, { status: 400 });
    }

    const updatedPost = updateXhsPost(body);
    
    if (updatedPost) {
      return NextResponse.json({ 
        success: true, 
        data: updatedPost,
        message: '作品已更新' 
      });
    } else {
      return NextResponse.json({ 
        error: '作品不存在或更新失败' 
      }, { status: 404 });
    }

  } catch (error) {
    console.error('更新小红书内容失败:', error);
    return NextResponse.json({ 
      error: `更新失败: ${String(error)}` 
    }, { status: 500 });
  }
}