import { 
  XhsPost, 
  MediaImage, 
  PostImage,
  createXhsPost, 
  getXhsPosts, 
  getXhsPost,
  createImage,
  createPostImage,
  updateImageUploadStatus,
  generateId 
} from './database/supabase';

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

/**
 * 保存小红书帖子到Supabase数据库
 */
export async function saveXhsPost(postData: any): Promise<SavedXhsPost> {
  try {
    const postId = generateId();
    
    // 准备帖子数据
    const xhsPost: Omit<XhsPost, 'saved_at' | 'updated_at'> = {
      id: postId,
      note_id: postData.note_id || '',
      title: postData.title || '',
      content: postData.content || '',
      author_name: postData.author?.name || postData.author_name || '',
      author_id: postData.author?.id || postData.author_id || '',
      author_avatar: postData.author?.avatar || postData.author_avatar || '',
      tags: Array.isArray(postData.tags) ? postData.tags.map((tag: any) => 
        typeof tag === 'string' ? tag : (tag?.name || String(tag))
      ) : [],
      like_count: Number(postData.like_count) || 0,
      comment_count: Number(postData.comment_count) || 0,
      share_count: Number(postData.share_count) || 0,
      collect_count: Number(postData.collect_count) || 0,
      original_url: postData.original_url || '',
      location: postData.location || '',
      publish_time: postData.publish_time || '',
      parsed_at: new Date().toISOString()
    };

    // 保存帖子主记录
    const savedPost = await createXhsPost(xhsPost);
    
    // 处理图片
    const images: Array<{
      id: string;
      original_url: string;
      oss_url?: string;
      width?: number;
      height?: number;
    }> = [];

    if (postData.imageList && Array.isArray(postData.imageList)) {
      for (let i = 0; i < postData.imageList.length; i++) {
        const imageData = postData.imageList[i];
        const imageId = generateId();
        
        // 创建图片记录
        const imageRecord: Omit<MediaImage, 'created_at' | 'updated_at'> = {
          id: imageId,
          original_url: imageData.urlDefault || imageData.url || '',
          width: imageData.width,
          height: imageData.height,
          source_platform: 'xiaohongshu',
          source_post_type: 'xhs_post',
          source_post_id: postId,
          image_type: 'content_image',
          upload_status: 'pending'
        };
        
        await createImage(imageRecord);
        
        // 创建帖子-图片关联
        await createPostImage({
          id: generateId(),
          post_type: 'xhs_post',
          post_id: postId,
          image_id: imageId,
          image_order: i
        });
        
        images.push({
          id: imageId,
          original_url: imageRecord.original_url || '',
          width: imageData.width,
          height: imageData.height
        });
      }
    } else if (postData.images && Array.isArray(postData.images)) {
      // 兼容旧格式
      for (let i = 0; i < postData.images.length; i++) {
        const imageData = postData.images[i];
        const imageId = generateId();
        
        // 创建图片记录
        const imageRecord: Omit<MediaImage, 'created_at' | 'updated_at'> = {
          id: imageId,
          original_url: imageData.url || imageData.original_url || '',
          width: imageData.width,
          height: imageData.height,
          source_platform: 'xiaohongshu',
          source_post_type: 'xhs_post',
          source_post_id: postId,
          image_type: 'content_image',
          upload_status: 'pending'
        };
        
        await createImage(imageRecord);
        
        // 创建帖子-图片关联
        await createPostImage({
          id: generateId(),
          post_type: 'xhs_post',
          post_id: postId,
          image_id: imageId,
          image_order: i
        });
        
        images.push({
          id: imageId,
          original_url: imageRecord.original_url || '',
          width: imageData.width,
          height: imageData.height
        });
      }
    }

    // 返回统一格式
    return {
      id: savedPost.id,
      note_id: savedPost.note_id,
      title: savedPost.title,
      content: savedPost.content,
      author_name: savedPost.author_name,
      author_id: savedPost.author_id,
      author_avatar: savedPost.author_avatar,
      tags: savedPost.tags,
      like_count: savedPost.like_count,
      comment_count: savedPost.comment_count,
      share_count: savedPost.share_count,
      collect_count: savedPost.collect_count,
      original_url: savedPost.original_url,
      location: savedPost.location,
      publish_time: savedPost.publish_time,
      saved_at: savedPost.saved_at || '',
      parsed_at: savedPost.parsed_at,
      images
    };
    
  } catch (error) {
    console.error('保存到Supabase失败:', error);
    throw error;
  }
}

/**
 * 获取所有小红书帖子
 */
export async function getAllXhsPosts(): Promise<SavedXhsPost[]> {
  try {
    const posts = await getXhsPosts(100); // 获取最近100条
    
    // 转换为统一格式
    return posts.map(post => ({
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
      saved_at: post.saved_at || '',
      parsed_at: post.parsed_at,
      images: [] // TODO: 关联查询图片
    }));
  } catch (error) {
    console.error('从Supabase查询失败:', error);
    throw error;
  }
}

/**
 * 根据ID获取单个帖子
 */
export async function getXhsPostById(id: string): Promise<SavedXhsPost | null> {
  try {
    const post = await getXhsPost(id);
    if (!post) return null;
    
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
      saved_at: post.saved_at || '',
      parsed_at: post.parsed_at,
      images: [] // TODO: 关联查询图片
    };
  } catch (error) {
    console.error('从Supabase查询单个帖子失败:', error);
    throw error;
  }
}

/**
 * 删除帖子
 */
export async function deleteXhsPost(id: string): Promise<void> {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://okkgchwzppghiyfgmrlj.supabase.co';
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ra2djaHd6cHBnaGl5ZmdtcmxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTY1NDA1MCwiZXhwIjoyMDY1MjMwMDUwfQ.tyKEsDr9lq2WtowiN0lBwKU2sxkKdRk6phBswiK88rE';
    
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpa_xhs_posts?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!res.ok) {
      throw new Error(`删除失败: ${res.status}`);
    }
  } catch (error) {
    console.error('删除帖子失败:', error);
    throw error;
  }
}