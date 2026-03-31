import { NextRequest, NextResponse } from 'next/server';
import { getAllXhsPosts, getXhsPostById } from '@/lib/content-storage-hybrid';

/**
 * GET /api/content/list/xhs
 * 查询已保存的小红书内容
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const id = searchParams.get('id');

    // 如果提供了ID，返回单条记录
    if (id) {
      const post = await getXhsPostById(id);
      if (!post) {
        return NextResponse.json({
          success: false,
          error: '内容不存在'
        }, { status: 404 });
      }
      
      return NextResponse.json({
        success: true,
        data: post,
      });
    }

    // 否则返回列表
    const posts = await getAllXhsPosts();
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