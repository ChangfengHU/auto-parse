import fs from 'fs';
import path from 'path';

const CONTENT_FILE = path.join(process.cwd(), '.content-library.json');

export interface SavedXhsPost {
  id: string;
  note_id: string;
  title: string;
  content?: string;
  author_name?: string;
  author_id?: string;
  author_avatar?: string;
  tags?: string[];
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  collect_count?: number;
  original_url?: string;
  location?: string;
  publish_time?: string;
  saved_at: string;
  parsed_at?: string;
  images?: Array<{
    id: string;
    original_url: string;
    oss_url?: string;
    width?: number;
    height?: number;
  }>;
}

function readAll(): SavedXhsPost[] {
  try {
    if (!fs.existsSync(CONTENT_FILE)) return [];
    return JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf-8')) as SavedXhsPost[];
  } catch {
    return [];
  }
}

function writeAll(list: SavedXhsPost[]) {
  fs.writeFileSync(CONTENT_FILE, JSON.stringify(list, null, 2));
}

/** 获取全部内容（最新在前） */
export function getAllXhsPosts(): SavedXhsPost[] {
  return readAll().sort((a, b) => new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime());
}

/** 保存内容到本地 JSON */
export function saveXhsPost(postData: any, originalUrl?: string): SavedXhsPost {
  const list = readAll();
  
  // 检查是否已存在（根据note_id）
  const noteId = postData.noteId || postData.note_id || '';
  const existing = list.find(p => p.note_id === noteId);
  
  if (existing) {
    // 更新现有记录
    const updated: SavedXhsPost = {
      ...existing,
      title: postData.title || existing.title,
      content: postData.desc || postData.content || existing.content,
      author_name: postData.user?.nickname || postData.author_name || existing.author_name,
      author_id: postData.user?.userId || postData.author_id || existing.author_id,
      author_avatar: postData.user?.avatar || postData.author_avatar || existing.author_avatar,
      tags: postData.tagList || postData.tags || existing.tags,
      like_count: parseInt(postData.interactInfo?.likedCount || postData.like_count || '0'),
      comment_count: parseInt(postData.interactInfo?.commentCount || postData.comment_count || '0'),
      share_count: parseInt(postData.interactInfo?.shareCount || postData.share_count || '0'),
      collect_count: parseInt(postData.interactInfo?.collectedCount || postData.collect_count || '0'),
      location: postData.ipLocation || postData.location || existing.location,
      original_url: originalUrl || existing.original_url,
      saved_at: new Date().toISOString()
    };
    
    const index = list.findIndex(p => p.note_id === noteId);
    list[index] = updated;
    writeAll(list);
    return updated;
  }
  
  // 创建新记录
  const newPost: SavedXhsPost = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    note_id: noteId,
    title: postData.title || '',
    content: postData.desc || '',
    author_name: postData.user?.nickname || '',
    author_id: postData.user?.userId || '',
    author_avatar: postData.user?.avatar || '',
    tags: postData.tagList || [],
    like_count: parseInt(postData.interactInfo?.likedCount || '0'),
    comment_count: parseInt(postData.interactInfo?.commentCount || '0'),
    share_count: parseInt(postData.interactInfo?.shareCount || '0'),
    collect_count: parseInt(postData.interactInfo?.collectedCount || '0'),
    original_url: originalUrl || '',
    location: postData.ipLocation || '',
    publish_time: postData.time ? new Date(parseInt(postData.time)).toISOString() : undefined,
    saved_at: new Date().toISOString(),
    parsed_at: new Date().toISOString(),
    images: (postData.imageList || []).map((img: any, index: number) => ({
      id: `${Date.now()}-img-${index}`,
      original_url: img.urlDefault,
      width: img.width,
      height: img.height
    }))
  };
  
  list.unshift(newPost);
  writeAll(list);
  return newPost;
}

/** 删除内容 */
export function deleteXhsPost(id: string): boolean {
  const list = readAll();
  const index = list.findIndex(p => p.id === id);
  if (index === -1) return false;
  
  list.splice(index, 1);
  writeAll(list);
  return true;
}

/** 获取单个内容 */
export function getXhsPostById(id: string): SavedXhsPost | null {
  const list = readAll();
  return list.find(p => p.id === id) || null;
}