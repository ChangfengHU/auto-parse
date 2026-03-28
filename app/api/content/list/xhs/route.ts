import { NextRequest, NextResponse } from 'next/server';
import { getAllXhsPosts } from '@/lib/content-storage';

/**
 * GET /api/content/list/xhs
 * 查询已保存的小红书内容
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '20');

    const posts = getAllXhsPosts();
    const limitedPosts = posts.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: limitedPosts,
      total: posts.length
    });

  } catch (error) {
    console.error('查询小红书内容失败:', error);
    return NextResponse.json({ 
      error: `查询失败: ${String(error)}` 
    }, { status: 500 });
  }
}