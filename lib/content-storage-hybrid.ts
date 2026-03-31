import { SavedXhsPost } from './content-storage';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://okkgchwzppghiyfgmrlj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ra2djaHd6cHBnaGl5ZmdtcmxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTY1NDA1MCwiZXhwIjoyMDY1MjMwMDUwfQ.tyKEsDr9lq2WtowiN0lBwKU2sxkKdRk6phBswiK88rE';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

/**
 * 保存小红书帖子到Supabase，如果失败则回退到本地存储
 */
export async function saveXhsPost(postData: any): Promise<SavedXhsPost> {
  try {
    const postId = generateId();
    const now = new Date().toISOString();
    
    // 准备要保存的数据
    const record = {
      id: postId,
      note_id: postData.note_id || postData.noteId || '',
      title: postData.title || '',
      content: postData.content || postData.desc || '',
      author_name: postData.author?.name || postData.author_name || '',
      author_id: postData.author?.id || postData.author_id || '',
      author_avatar: postData.author?.avatar || postData.author_avatar || '',
      tags: Array.isArray(postData.tags) ? postData.tags.map((tag: any) => 
        typeof tag === 'string' ? tag : (tag?.name || String(tag))
      ) : [],
      like_count: Number(postData.like_count || postData.likedCount) || 0,
      comment_count: Number(postData.comment_count || postData.commentCount) || 0,
      share_count: Number(postData.share_count || postData.shareCount) || 0,
      collect_count: Number(postData.collect_count || postData.collectCount) || 0,
      original_url: postData.original_url || '',
      location: postData.location || '',
      publish_time: postData.publish_time || postData.time || null,
      parsed_at: now,
      saved_at: now,
      updated_at: now
    };

    // 直接尝试插入数据
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpa_xhs_posts`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(record)
    });

    if (response.ok) {
      const [savedRecord] = await response.json();
      console.log('✅ 成功保存到Supabase:', postId);
      
      // 处理图片
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
        images
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
    return saveLocal(postData, postData.original_url);
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
      const postsWithImages = await Promise.all(posts.map(async (post: any) => {
        const images = await getImagesByPostId(post.id);
        return {
          id: post.id,
          note_id: post.note_id,
          title: post.title,
          content: post.content,
          author_name: post.author_name,
          author_id: post.author_id,
          author_avatar: post.author_avatar,
          tags: post.tags,
          like_count: post.like_count,
          comment_count: post.comment_count,
          share_count: post.share_count,
          collect_count: post.collect_count,
          original_url: post.original_url,
          location: post.location,
          publish_time: post.publish_time,
          saved_at: post.saved_at,
          parsed_at: post.parsed_at,
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
      
      const post = posts[0];
      const images = await getImagesByPostId(post.id);
      
      return {
        id: post.id,
        note_id: post.note_id,
        title: post.title,
        content: post.content,
        author_name: post.author_name,
        author_id: post.author_id,
        author_avatar: post.author_avatar,
        tags: post.tags,
        like_count: post.like_count,
        comment_count: post.comment_count,
        share_count: post.share_count,
        collect_count: post.collect_count,
        original_url: post.original_url,
        location: post.location,
        publish_time: post.publish_time,
        saved_at: post.saved_at,
        parsed_at: post.parsed_at,
        images
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