import { NextRequest, NextResponse } from 'next/server';
import { initTables } from '@/lib/database/supabase';

/**
 * POST /api/database/init
 * 初始化数据库表
 */
export async function POST(req: NextRequest) {
  try {
    await initTables();
    return NextResponse.json({
      success: true,
      message: '数据库表初始化成功'
    });
  } catch (error) {
    console.error('数据库初始化失败:', error);
    return NextResponse.json({ 
      error: `初始化失败: ${String(error)}` 
    }, { status: 500 });
  }
}