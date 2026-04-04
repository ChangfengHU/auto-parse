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
  video?: {
    id?: string;
    original_url: string;
    oss_url?: string;
  };
  comments?: XhsStoredComment[];
}

export interface XhsStoredComment {
  id: string;
  comment_id?: string;
  nickname: string;
  avatar?: string;
  content: string;
  like_count?: number;
  sub_comment_count?: number;
  comment_index?: number;
}

type RawTag = string;

type RawImage = {
  previewUrl?: string;
  originalUrl?: string;
  urlDefault?: string;
  url?: string;
  original_url?: string;
  oss_url?: string;
  width?: number;
  height?: number;
};

type RawVideo = {
  url?: string;
  original_url?: string;
  oss_url?: string;
};

type RawNoteData = {
  noteId?: string;
  note_id?: string;
  title?: string;
  desc?: string;
  content?: string;
  author?: { name?: string; id?: string; avatar?: string };
  user?: { nickname?: string; userId?: string; avatar?: string };
  tags?: RawTag[];
  tagList?: RawTag[];
  stats?: { likes?: number; comments?: number; shares?: number; collects?: number };
  interactInfo?: { likedCount?: string; commentCount?: string; shareCount?: string; collectedCount?: string };
  like_count?: number | string;
  comment_count?: number | string;
  share_count?: number | string;
  collect_count?: number | string;
  ipLocation?: string;
  location?: string;
  publishTime?: string;
  time?: string;
  images?: RawImage[];
  imageList?: RawImage[];
  postUrl?: string;
  original_url?: string;
  video?: RawVideo;
  comments?: unknown;
};

function normalizeComments(comments: unknown): XhsStoredComment[] {
  if (!Array.isArray(comments)) return [];
  return comments.map((comment, index) => {
    const item = (comment ?? {}) as Record<string, unknown>;
    return {
      id: String(item.id || `${Date.now()}-comment-${index}`),
      comment_id: item.comment_id ? String(item.comment_id) : undefined,
      nickname: String(item.nickname || '匿名用户'),
      avatar: item.avatar ? String(item.avatar) : undefined,
      content: String(item.content || ''),
      like_count: Number(item.like_count ?? item.likeCount ?? 0) || 0,
      sub_comment_count: Number(item.sub_comment_count ?? item.subCommentCount ?? 0) || 0,
      comment_index: Number(item.comment_index ?? item.commentIndex ?? index) || index,
    };
  });
}

function normalizeOriginalPostUrl(postData: RawNoteData, originalUrl?: string): string {
  return originalUrl || postData.postUrl || postData.original_url || '';
}

function normalizeVideo(video: RawVideo | undefined): SavedXhsPost['video'] {
  if (!video) return undefined;
  const originalUrl = video.original_url || video.url || '';
  const ossUrl = video.oss_url;
  if (!originalUrl && !ossUrl) return undefined;
  return {
    original_url: originalUrl,
    oss_url: ossUrl || undefined,
  };
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
export function saveXhsPost(postData: RawNoteData, originalUrl?: string): SavedXhsPost {
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
      author_name: postData.author?.name || postData.user?.nickname || postData.author_name || existing.author_name,
      author_id: postData.author?.id || postData.user?.userId || postData.author_id || existing.author_id,
      author_avatar: postData.author?.avatar || postData.user?.avatar || postData.author_avatar || existing.author_avatar,
      tags: postData.tags || postData.tagList || existing.tags,
      like_count: postData.stats?.likes || parseInt(postData.interactInfo?.likedCount || postData.like_count || '0'),
      comment_count: postData.stats?.comments || parseInt(postData.interactInfo?.commentCount || postData.comment_count || '0'),
      share_count: postData.stats?.shares || parseInt(postData.interactInfo?.shareCount || postData.share_count || '0'),
      collect_count: postData.stats?.collects || parseInt(postData.interactInfo?.collectedCount || postData.collect_count || '0'),
      location: postData.ipLocation || postData.location || existing.location,
      original_url: normalizeOriginalPostUrl(postData, originalUrl) || existing.original_url,
      saved_at: new Date().toISOString(),
      video: normalizeVideo(postData.video) || existing.video,
      comments: normalizeComments(postData.comments).length > 0 ? normalizeComments(postData.comments) : existing.comments,
      images: (postData.images || postData.imageList || []).map((img, index) => ({
        id: `${Date.now()}-img-${index}`,
        original_url: img.originalUrl || img.previewUrl || img.urlDefault || img.url || img.original_url || '',
        oss_url: img.oss_url || undefined,
        width: img.width,
        height: img.height
      }))
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
    author_name: postData.author?.name || postData.user?.nickname || '',
    author_id: postData.author?.id || postData.user?.userId || '',
    author_avatar: postData.author?.avatar || postData.user?.avatar || '',
    tags: postData.tags || postData.tagList || [],
    like_count: postData.stats?.likes || parseInt(postData.interactInfo?.likedCount || '0'),
    comment_count: postData.stats?.comments || parseInt(postData.interactInfo?.commentCount || '0'),
    share_count: postData.stats?.shares || parseInt(postData.interactInfo?.shareCount || '0'),
    collect_count: postData.stats?.collects || parseInt(postData.interactInfo?.collectedCount || '0'),
    original_url: normalizeOriginalPostUrl(postData, originalUrl),
    location: postData.ipLocation || '',
    publish_time: postData.publishTime || (postData.time ? new Date(parseInt(postData.time)).toISOString() : undefined),
    saved_at: new Date().toISOString(),
    parsed_at: new Date().toISOString(),
    video: normalizeVideo(postData.video),
    comments: normalizeComments(postData.comments),
    images: (postData.images || postData.imageList || []).map((img, index) => ({
      id: `${Date.now()}-img-${index}`,
      original_url: img.originalUrl || img.previewUrl || img.urlDefault || img.url || img.original_url || '',
      oss_url: img.oss_url || undefined,
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

/** 更新帖子图片的OSS地址 */
export function updatePostImagesOss(postId: string, ossUpdates: Array<{index: number, ossUrl: string}>): void {
  const list = readAll();
  const postIndex = list.findIndex(p => p.id === postId);
  
  if (postIndex === -1) return;
  
  const post = list[postIndex];
  if (!post.images) return;
  
  // 更新对应索引的图片OSS地址
  ossUpdates.forEach(update => {
    if (post.images && post.images[update.index]) {
      post.images[update.index].oss_url = update.ossUrl;
    }
  });
  
  // 更新保存时间
  post.saved_at = new Date().toISOString();
  
  list[postIndex] = post;
  writeAll(list);
  
  console.log(`已更新帖子 ${postId} 的图片OSS地址`);
}

/** 更新内容 */
export function updateXhsPost(updatedData: Partial<SavedXhsPost> & { id: string }): SavedXhsPost | null {
  const list = readAll();
  const index = list.findIndex(p => p.id === updatedData.id);
  if (index === -1) return null;
  
  // 保留原始数据，只更新提供的字段
  const originalPost = list[index];
  const updatedPost: SavedXhsPost = {
    ...originalPost,
    ...updatedData,
    saved_at: originalPost.saved_at, // 保持原始保存时间
    id: originalPost.id, // 确保ID不被修改
    note_id: originalPost.note_id, // 确保note_id不被修改
  };
  
  list[index] = updatedPost;
  writeAll(list);
  return updatedPost;
}

/** 获取单个内容 */
export function getXhsPostById(id: string): SavedXhsPost | null {
  const list = readAll();
  return list.find(p => p.id === id) || null;
}
