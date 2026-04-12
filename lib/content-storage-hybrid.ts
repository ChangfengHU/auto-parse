import { SavedXhsPost, XhsStoredComment } from './content-storage';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  '';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickCount(...values: unknown[]): number {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

function toStringOrEmpty(value: unknown): string {
  return value == null ? '' : typeof value === 'string' ? value : String(value);
}

function toOptionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = value.filter((v): v is string => typeof v === 'string');
  return arr.length ? arr : undefined;
}

function normalizeComments(comments: unknown): XhsStoredComment[] {
  if (!Array.isArray(comments)) return [];
  return comments.map((comment, index) => {
    const item = (comment ?? {}) as Record<string, unknown>;
    return {
      id: String(item.id || generateId()),
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
  original_url?: string;
  note_id?: string;
  noteId?: string;
  title?: string;
  content?: string;
  desc?: string;
  author?: { name?: string; id?: string; avatar?: string };
  author_name?: string;
  author_id?: string;
  author_avatar?: string;
  tags?: RawTag[];
  stats?: { likes?: number; comments?: number; shares?: number; collects?: number };
  like_count?: number | string;
  likedCount?: number | string;
  comment_count?: number | string;
  commentCount?: number | string;
  share_count?: number | string;
  shareCount?: number | string;
  collect_count?: number | string;
  collectCount?: number | string;
  location?: string;
  publish_time?: string;
  time?: string | null;
  postUrl?: string;
  comments?: unknown;
  imageList?: RawImage[];
  images?: RawImage[];
  video?: RawVideo;
};

/**
 * 根据帖子ID查询关联的图片
 */
async function getImagesByPostId(postId: string): Promise<Array<{
  id: string;
  original_url: string;
  oss_url?: string;
  width?: number;
  height?: number;
}>> {
  try {
    // 直接按 source_post_id 查询 rpa_images
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpa_images?source_post_id=eq.${encodeURIComponent(postId)}&select=id,original_url,oss_url,width,height&order=created_at.asc`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      }
    );
    if (res.ok) return await res.json();
    return [];
  } catch (error) {
    console.warn('查询图片失败:', error);
    return [];
  }
}

async function getCommentsByPostId(postId: string): Promise<XhsStoredComment[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpa_xhs_comments?post_id=eq.${encodeURIComponent(postId)}&select=id,xhs_comment_id,nickname,avatar,content,like_count,sub_comment_count,comment_index&order=comment_index.asc`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      }
    );
    if (!res.ok) return [];

    const rows = await res.json();
    return Array.isArray(rows) ? rows.map((row: Record<string, unknown>, index: number) => ({
      id: String(row.id || generateId()),
      comment_id: row.xhs_comment_id ? String(row.xhs_comment_id) : undefined,
      nickname: String(row.nickname || '匿名用户'),
      avatar: row.avatar ? String(row.avatar) : undefined,
      content: String(row.content || ''),
      like_count: Number(row.like_count ?? 0) || 0,
      sub_comment_count: Number(row.sub_comment_count ?? 0) || 0,
      comment_index: Number(row.comment_index ?? index) || index,
    })) : [];
  } catch (error) {
    console.warn('查询评论失败:', error);
    return [];
  }
}

async function getVideoByPostId(postId: string): Promise<SavedXhsPost['video']> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpa_videos?source_post_id=eq.${encodeURIComponent(postId)}&source_post_type=eq.xhs_post&select=id,original_url,oss_url&order=created_at.asc&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      }
    );
    if (!res.ok) return undefined;

    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return undefined;
    return {
      id: String(row.id || ''),
      original_url: String(row.original_url || ''),
      oss_url: row.oss_url ? String(row.oss_url) : undefined,
    };
  } catch (error) {
    console.warn('查询视频失败:', error);
    return undefined;
  }
}

function normalizeOriginalPostUrl(postData: RawNoteData): string {
  return postData.original_url || postData.postUrl || '';
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

/**
 * 保存小红书帖子到Supabase，如果失败则回退到本地存储
 */
export async function saveXhsPost(postData: RawNoteData): Promise<SavedXhsPost> {
  try {
    // 1. 检查是否存在相同 URL 的记录
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rpa_xhs_posts?original_url=eq.${encodeURIComponent(postData.original_url || '')}&select=id`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      }
    );
    
    let existingId = null;
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing.length > 0) existingId = existing[0].id;
    }

    const postId = existingId || generateId();
    const now = new Date().toISOString();
    const normalizedComments = normalizeComments(postData.comments);
    
    // 准备要保存的数据
    const record = {
      id: postId,
      note_id: postData.note_id || postData.noteId || '',
      title: postData.title || '',
      content: postData.content || postData.desc || '',
      author_name: postData.author?.name || postData.author_name || '',
      author_id: postData.author?.id || postData.author_id || '',
      author_avatar: postData.author?.avatar || postData.author_avatar || '',
      tags: Array.isArray(postData.tags) ? postData.tags.map((tag) => String(tag)) : [],
      like_count: pickCount(postData.like_count, postData.likedCount, postData.stats?.likes),
      comment_count: pickCount(postData.comment_count, postData.commentCount, postData.stats?.comments, normalizedComments.length),
      share_count: pickCount(postData.share_count, postData.shareCount, postData.stats?.shares),
      collect_count: pickCount(postData.collect_count, postData.collectCount, postData.stats?.collects),
      original_url: normalizeOriginalPostUrl(postData),
      location: postData.location || '',
      publish_time: postData.publish_time || postData.time || null,
      parsed_at: now,
      saved_at: now,
      updated_at: now
    };

    // 2. 使用 Upsert 方式保存 (带 on_conflict)
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpa_xhs_posts?on_conflict=id`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(record)
    });

    if (response.ok) {
      const respJson = await response.json();
      const savedRecord = respJson[0];
      console.log(existingId ? '✅ 成功更新到Supabase:' : '✅ 成功保存到Supabase:', postId);
      
      // 3. 处理图片：先清理旧图片记录（如果是更新），再重新保存
      if (existingId) {
        await fetch(`${SUPABASE_URL}/rest/v1/rpa_images?source_post_id=eq.${encodeURIComponent(postId)}`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          }
        });

        await fetch(`${SUPABASE_URL}/rest/v1/rpa_xhs_comments?post_id=eq.${encodeURIComponent(postId)}`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          }
        });

        await fetch(`${SUPABASE_URL}/rest/v1/rpa_videos?source_post_id=eq.${encodeURIComponent(postId)}&source_post_type=eq.xhs_post`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          }
        });
      }

      const images: Array<{
        id: string;
        original_url: string;
        oss_url?: string;
        width?: number;
        height?: number;
      }> = [];
      const imageList = postData.imageList || postData.images || [];
      for (let i = 0; i < imageList.length; i++) {
        const imageData = imageList[i];
        const imageId = generateId();
        
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/rpa_images`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id: imageId,
              original_url: imageData.previewUrl || imageData.originalUrl || imageData.urlDefault || imageData.url || imageData.original_url || '',
              oss_url: imageData.oss_url || null,
              width: imageData.width,
              height: imageData.height,
              source_platform: 'xiaohongshu',
              source_post_type: 'xhs_post',
              source_post_id: postId,
              image_type: 'content_image',
              upload_status: imageData.oss_url ? 'completed' : 'pending',
              created_at: now,
              updated_at: now
            })
          });

          images.push({
            id: imageId,
            original_url: imageData.previewUrl || imageData.originalUrl || imageData.urlDefault || imageData.url || imageData.original_url || '',
            oss_url: imageData.oss_url || undefined,
            width: imageData.width,
            height: imageData.height
          });
        } catch (err) {
          console.warn('保存图片失败:', err);
        }
      }

      const savedVideo = normalizeVideo(postData.video);
      if (savedVideo) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/rpa_videos`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id: generateId(),
              original_url: savedVideo.original_url,
              oss_url: savedVideo.oss_url || null,
              source_platform: 'xiaohongshu',
              source_post_type: 'xhs_post',
              source_post_id: postId,
              format: 'mp4',
              upload_status: savedVideo.oss_url ? 'completed' : 'pending',
              upload_at: savedVideo.oss_url ? now : null,
              created_at: now,
              updated_at: now,
            }),
          });
        } catch (err) {
          console.warn('保存视频失败:', err);
        }
      }

      const comments: XhsStoredComment[] = [];
      for (let i = 0; i < normalizedComments.length; i++) {
        const comment = normalizedComments[i];
        const commentRow = {
          id: generateId(),
          post_id: postId,
          note_id: savedRecord.note_id || '',
          xhs_comment_id: comment.comment_id || comment.id,
          nickname: comment.nickname,
          avatar: comment.avatar || null,
          content: comment.content,
          like_count: comment.like_count || 0,
          sub_comment_count: comment.sub_comment_count || 0,
          comment_index: comment.comment_index ?? i,
          created_at: now,
          updated_at: now,
        };

        try {
          await fetch(`${SUPABASE_URL}/rest/v1/rpa_xhs_comments`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(commentRow),
          });
          comments.push({
            id: commentRow.id,
            comment_id: commentRow.xhs_comment_id,
            nickname: comment.nickname,
            avatar: comment.avatar,
            content: comment.content,
            like_count: comment.like_count || 0,
            sub_comment_count: comment.sub_comment_count || 0,
            comment_index: comment.comment_index ?? i,
          });
        } catch (err) {
          console.warn('保存评论失败:', err);
        }
      }

      return {
        id: savedRecord.id,
        note_id: savedRecord.note_id,
        title: savedRecord.title,
        content: savedRecord.content,
        author_name: savedRecord.author_name,
        author_id: savedRecord.author_id,
        author_avatar: savedRecord.author_avatar,
        tags: savedRecord.tags,
        like_count: savedRecord.like_count,
        comment_count: savedRecord.comment_count,
        share_count: savedRecord.share_count,
        collect_count: savedRecord.collect_count,
        original_url: savedRecord.original_url,
        location: savedRecord.location,
        publish_time: savedRecord.publish_time,
        saved_at: savedRecord.saved_at,
        parsed_at: savedRecord.parsed_at,
        images,
        video: savedVideo,
        comments
      };
    } else {
      const error = await response.text();
      console.log('Supabase保存失败，回退到本地存储:', error);
      throw new Error(error);
    }
  } catch (error) {
    console.log('🔄 Supabase不可用，使用本地存储:', error);
    // 回退到本地存储
    const { saveXhsPost: saveLocal } = await import('./content-storage');
    return saveLocal({ ...postData, time: postData.time ?? undefined }, postData.original_url);
  }
}

/**
 * 获取所有小红书帖子
 */
export async function getAllXhsPosts(): Promise<SavedXhsPost[]> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpa_xhs_posts?select=*&order=saved_at.desc&limit=100`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      }
    );

    if (response.ok) {
      const posts = await response.json();
      
      // 为每个帖子查询关联的图片
      const postsWithImages = await Promise.all((posts as Array<Record<string, unknown>>).map(async (post) => {
        const postId = toStringOrEmpty(post.id);
        const images = postId ? await getImagesByPostId(postId) : [];
        return {
          id: postId,
          note_id: toStringOrEmpty(post.note_id),
          title: toStringOrEmpty(post.title),
          content: typeof post.content === 'string' ? post.content : undefined,
          author_name: typeof post.author_name === 'string' ? post.author_name : undefined,
          author_id: typeof post.author_id === 'string' ? post.author_id : undefined,
          author_avatar: typeof post.author_avatar === 'string' ? post.author_avatar : undefined,
          tags: toOptionalStringArray(post.tags),
          like_count: toOptionalNumber(post.like_count),
          comment_count: toOptionalNumber(post.comment_count),
          share_count: toOptionalNumber(post.share_count),
          collect_count: toOptionalNumber(post.collect_count),
          original_url: typeof post.original_url === 'string' ? post.original_url : undefined,
          location: typeof post.location === 'string' ? post.location : undefined,
          publish_time: typeof post.publish_time === 'string' ? post.publish_time : undefined,
          saved_at: toStringOrEmpty(post.saved_at) || new Date().toISOString(),
          parsed_at: typeof post.parsed_at === 'string' ? post.parsed_at : undefined,
          images
        };
      }));
      
      return postsWithImages;
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.log('🔄 Supabase查询失败，使用本地存储:', error);
    const { getAllXhsPosts: getLocal } = await import('./content-storage');
    return getLocal();
  }
}

/**
 * 根据ID获取单个帖子
 */
export async function getXhsPostById(id: string): Promise<SavedXhsPost | null> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpa_xhs_posts?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      }
    );

    if (response.ok) {
      const posts = await response.json();
      if (posts.length === 0) return null;
      
      const post = posts[0] as Record<string, unknown>;
      const postId = toStringOrEmpty(post.id);
      const images = postId ? await getImagesByPostId(postId) : [];
      const comments = postId ? await getCommentsByPostId(postId) : [];
      const video = postId ? await getVideoByPostId(postId) : null;
      
      return {
        id: postId,
        note_id: toStringOrEmpty(post.note_id),
        title: toStringOrEmpty(post.title),
        content: typeof post.content === 'string' ? post.content : undefined,
        author_name: typeof post.author_name === 'string' ? post.author_name : undefined,
        author_id: typeof post.author_id === 'string' ? post.author_id : undefined,
        author_avatar: typeof post.author_avatar === 'string' ? post.author_avatar : undefined,
        tags: toOptionalStringArray(post.tags),
        like_count: toOptionalNumber(post.like_count),
        comment_count: toOptionalNumber(post.comment_count),
        share_count: toOptionalNumber(post.share_count),
        collect_count: toOptionalNumber(post.collect_count),
        original_url: typeof post.original_url === 'string' ? post.original_url : undefined,
        location: typeof post.location === 'string' ? post.location : undefined,
        publish_time: typeof post.publish_time === 'string' ? post.publish_time : undefined,
        saved_at: toStringOrEmpty(post.saved_at) || new Date().toISOString(),
        parsed_at: typeof post.parsed_at === 'string' ? post.parsed_at : undefined,
        images,
        video: video || undefined,
        comments
      };
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.log('🔄 Supabase单个查询失败，使用本地存储:', error);
    const { getAllXhsPosts: getLocal } = await import('./content-storage');
    const posts = getLocal();
    return posts.find(p => p.id === id) || null;
  }
}

/**
 * 删除帖子
 */
export async function deleteXhsPost(id: string): Promise<void> {
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/rpa_xhs_comments?post_id=eq.${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      }
    );

    await fetch(
      `${SUPABASE_URL}/rest/v1/rpa_videos?source_post_id=eq.${encodeURIComponent(id)}&source_post_type=eq.xhs_post`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      }
    );

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpa_xhs_posts?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.log('🔄 Supabase删除失败，使用本地存储:', error);
    const { deleteXhsPost: deleteLocal } = await import('./content-storage');
    deleteLocal(id);
  }
}
