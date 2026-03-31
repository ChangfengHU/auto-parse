import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://okkgchwzppghiyfgmrlj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ra2djaHd6cHBnaGl5ZmdtcmxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTY1NDA1MCwiZXhwIjoyMDY1MjMwMDUwfQ.tyKEsDr9lq2WtowiN0lBwKU2sxkKdRk6phBswiK88rE';

/**
 * POST /api/database/create-tables
 * 创建数据库表结构
 */
export async function POST(req: NextRequest) {
  try {
    const tables = [
      {
        name: 'rpa_xhs_posts',
        sql: `CREATE TABLE IF NOT EXISTS rpa_xhs_posts (
          id TEXT PRIMARY KEY,
          note_id TEXT,
          title TEXT,
          content TEXT,
          author_name TEXT,
          author_id TEXT,
          author_avatar TEXT,
          author_level TEXT,
          tags TEXT[],
          like_count INTEGER DEFAULT 0,
          comment_count INTEGER DEFAULT 0,
          share_count INTEGER DEFAULT 0,
          collect_count INTEGER DEFAULT 0,
          view_count INTEGER DEFAULT 0,
          original_url TEXT,
          cover_image_id TEXT,
          location TEXT,
          publish_time TIMESTAMPTZ,
          parsed_at TIMESTAMPTZ,
          saved_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );`
      },
      {
        name: 'rpa_images',
        sql: `CREATE TABLE IF NOT EXISTS rpa_images (
          id TEXT PRIMARY KEY,
          original_url TEXT,
          oss_url TEXT,
          local_path TEXT,
          filename TEXT,
          file_size BIGINT,
          width INTEGER,
          height INTEGER,
          format TEXT,
          source_platform TEXT,
          source_post_type TEXT,
          source_post_id TEXT,
          image_type TEXT,
          upload_status TEXT DEFAULT 'pending',
          upload_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );`
      },
      {
        name: 'rpa_post_images',
        sql: `CREATE TABLE IF NOT EXISTS rpa_post_images (
          id TEXT PRIMARY KEY,
          post_type TEXT NOT NULL,
          post_id TEXT NOT NULL,
          image_id TEXT NOT NULL,
          image_order INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          FOREIGN KEY (image_id) REFERENCES rpa_images(id) ON DELETE CASCADE
        );`
      }
    ];

    const results = [];
    
    for (const table of tables) {
      try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: table.sql
          })
        });

        if (response.ok) {
          results.push(`✅ ${table.name} 创建成功`);
        } else {
          const error = await response.text();
          results.push(`❌ ${table.name} 创建失败: ${error}`);
        }
      } catch (error) {
        results.push(`❌ ${table.name} 创建异常: ${error}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: '数据库表创建完成',
      results
    });

  } catch (error) {
    console.error('创建数据库表失败:', error);
    return NextResponse.json({ 
      error: `创建失败: ${String(error)}` 
    }, { status: 500 });
  }
}