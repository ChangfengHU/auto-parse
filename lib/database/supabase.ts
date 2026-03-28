/**
 * Supabase 数据库操作封装
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://okkgchwzppghiyfgmrlj.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ra2djaHd6cHBnaGl5ZmdtcmxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTY1NDA1MCwiZXhwIjoyMDY1MjMwMDUwfQ.tyKEsDr9lq2WtowiN0lBwKU2sxkKdRk6phBswiK88rE';

function headers(extra?: Record<string, string>) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extra,
  };
}

// 数据类型定义
export interface XhsPost {
  id: string;
  note_id: string;
  title: string;
  content?: string;
  author_name?: string;
  author_id?: string;
  author_avatar?: string;
  author_level?: string;
  tags?: string[];
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  collect_count?: number;
  view_count?: number;
  original_url?: string;
  cover_image_id?: string;
  location?: string;
  publish_time?: string;
  parsed_at?: string;
  saved_at?: string;
  updated_at?: string;
}

export interface DouyinPost {
  id: string;
  aweme_id: string;
  title?: string;
  description?: string;
  author_name?: string;
  author_id?: string;
  author_avatar?: string;
  author_signature?: string;
  music_title?: string;
  music_author?: string;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  collect_count?: number;
  play_count?: number;
  original_url?: string;
  video_id?: string;
  cover_image_id?: string;
  duration?: number;
  publish_time?: string;
  parsed_at?: string;
  saved_at?: string;
  updated_at?: string;
}

export interface MediaImage {
  id: string;
  original_url?: string;
  oss_url?: string;
  local_path?: string;
  filename?: string;
  file_size?: number;
  width?: number;
  height?: number;
  format?: string;
  source_platform?: string;
  source_post_type?: string;
  source_post_id?: string;
  image_type?: string;
  upload_status?: string;
  upload_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface MediaVideo {
  id: string;
  original_url?: string;
  oss_url?: string;
  local_path?: string;
  filename?: string;
  file_size?: number;
  duration?: number;
  width?: number;
  height?: number;
  format?: string;
  bitrate?: number;
  fps?: number;
  has_watermark?: boolean;
  source_platform?: string;
  source_post_type?: string;
  source_post_id?: string;
  upload_status?: string;
  upload_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PostImage {
  id: string;
  post_type: string;
  post_id: string;
  image_id: string;
  image_order?: number;
  created_at?: string;
}

/**
 * 执行SQL命令（需要rpc函数支持）
 */
export async function execSQL(sql: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQL执行失败: ${res.status} - ${text}`);
  }
  return res.json();
}

/**
 * 初始化数据库表（创建表结构）
 */
export async function initTables(): Promise<void> {
  // 由于Supabase不支持exec_sql函数，我们通过直接创建记录的方式来确保表存在
  // 表结构应该在Supabase管理界面中预先创建
  console.log('数据库表初始化：请确保在Supabase中已创建相关表');
}

// === 小红书作品操作 ===
export async function createXhsPost(post: Omit<XhsPost, 'saved_at' | 'updated_at'>): Promise<XhsPost> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpa_xhs_posts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      ...post,
      saved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }),
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`创建小红书作品失败: ${res.status} - ${text}`);
  }
  
  const rows: XhsPost[] = await res.json();
  return rows[0];
}

export async function getXhsPosts(limit = 20): Promise<XhsPost[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpa_xhs_posts?select=*&order=saved_at.desc&limit=${limit}`,
    { headers: headers() }
  );
  
  if (!res.ok) {
    throw new Error(`查询小红书作品失败: ${res.status}`);
  }
  
  return res.json();
}

export async function getXhsPost(id: string): Promise<XhsPost | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpa_xhs_posts?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { headers: headers() }
  );
  
  if (!res.ok) {
    throw new Error(`查询小红书作品失败: ${res.status}`);
  }
  
  const rows: XhsPost[] = await res.json();
  return rows[0] || null;
}

// === 图片资源操作 ===
export async function createImage(image: Omit<MediaImage, 'created_at' | 'updated_at'>): Promise<MediaImage> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpa_images`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      ...image,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }),
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`创建图片记录失败: ${res.status} - ${text}`);
  }
  
  const rows: MediaImage[] = await res.json();
  return rows[0];
}

export async function updateImageUploadStatus(id: string, status: string, ossUrl?: string): Promise<void> {
  const body: any = {
    upload_status: status,
    updated_at: new Date().toISOString()
  };
  
  if (ossUrl) {
    body.oss_url = ossUrl;
    body.upload_at = new Date().toISOString();
  }
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpa_images?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });
  
  if (!res.ok) {
    throw new Error(`更新图片状态失败: ${res.status}`);
  }
}

// === 图片关联操作 ===
export async function createPostImage(relation: Omit<PostImage, 'created_at'>): Promise<PostImage> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpa_post_images`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      ...relation,
      created_at: new Date().toISOString()
    }),
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`创建图片关联失败: ${res.status} - ${text}`);
  }
  
  const rows: PostImage[] = await res.json();
  return rows[0];
}

// === 工具函数 ===
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}