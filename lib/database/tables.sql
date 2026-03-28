-- RPA 自媒体内容管理系统数据库表
-- 所有表使用 rpa_ 前缀

-- 1. 小红书作品表
CREATE TABLE IF NOT EXISTS rpa_xhs_posts (
  id VARCHAR(50) PRIMARY KEY,
  note_id VARCHAR(50) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  author_name VARCHAR(100),
  author_id VARCHAR(50),
  author_avatar VARCHAR(500),
  author_level VARCHAR(20),
  tags JSONB, -- JSON 数组格式存储
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  collect_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  original_url VARCHAR(500),
  cover_image_id VARCHAR(50), -- 关联 rpa_images.id
  location VARCHAR(100),
  publish_time TIMESTAMPTZ,
  parsed_at TIMESTAMPTZ DEFAULT NOW(),
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 抖音作品表
CREATE TABLE IF NOT EXISTS rpa_douyin_posts (
  id VARCHAR(50) PRIMARY KEY,
  aweme_id VARCHAR(50) UNIQUE NOT NULL,
  title TEXT,
  description TEXT,
  author_name VARCHAR(100),
  author_id VARCHAR(50),
  author_avatar VARCHAR(500),
  author_signature TEXT,
  music_title VARCHAR(200),
  music_author VARCHAR(100),
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  collect_count INTEGER DEFAULT 0,
  play_count INTEGER DEFAULT 0,
  original_url VARCHAR(500),
  video_id VARCHAR(50), -- 关联 rpa_videos.id
  cover_image_id VARCHAR(50), -- 关联 rpa_images.id
  duration INTEGER, -- 视频时长(秒)
  publish_time TIMESTAMPTZ,
  parsed_at TIMESTAMPTZ DEFAULT NOW(),
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 微信公众号文章表
CREATE TABLE IF NOT EXISTS rpa_wechat_posts (
  id VARCHAR(50) PRIMARY KEY,
  article_id VARCHAR(50) UNIQUE,
  title TEXT NOT NULL,
  content TEXT,
  summary TEXT,
  author_name VARCHAR(100),
  account_name VARCHAR(100),
  account_id VARCHAR(50),
  read_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  original_url VARCHAR(500),
  cover_image_id VARCHAR(50), -- 关联 rpa_images.id
  publish_time TIMESTAMPTZ,
  parsed_at TIMESTAMPTZ DEFAULT NOW(),
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 图片资源表
CREATE TABLE IF NOT EXISTS rpa_images (
  id VARCHAR(50) PRIMARY KEY,
  original_url VARCHAR(500),
  oss_url VARCHAR(500),
  local_path VARCHAR(500),
  filename VARCHAR(255),
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  format VARCHAR(10), -- jpg, png, webp
  source_platform VARCHAR(20), -- xiaohongshu, douyin, wechat, other
  source_post_type VARCHAR(20), -- xhs_post, douyin_post, wechat_post
  source_post_id VARCHAR(50),
  image_type VARCHAR(20), -- cover, content, avatar
  upload_status VARCHAR(20) DEFAULT 'pending', -- pending, uploading, success, failed
  upload_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 视频资源表
CREATE TABLE IF NOT EXISTS rpa_videos (
  id VARCHAR(50) PRIMARY KEY,
  original_url VARCHAR(500),
  oss_url VARCHAR(500),
  local_path VARCHAR(500),
  filename VARCHAR(255),
  file_size INTEGER,
  duration INTEGER, -- 时长(秒)
  width INTEGER,
  height INTEGER,
  format VARCHAR(10), -- mp4, mov, avi
  bitrate INTEGER,
  fps INTEGER,
  has_watermark BOOLEAN DEFAULT FALSE,
  source_platform VARCHAR(20), -- xiaohongshu, douyin, wechat, other
  source_post_type VARCHAR(20), -- xhs_post, douyin_post, wechat_post
  source_post_id VARCHAR(50),
  upload_status VARCHAR(20) DEFAULT 'pending', -- pending, uploading, success, failed
  upload_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 图片关联表
CREATE TABLE IF NOT EXISTS rpa_post_images (
  id VARCHAR(50) PRIMARY KEY,
  post_type VARCHAR(20), -- xhs_post, douyin_post, wechat_post
  post_id VARCHAR(50),
  image_id VARCHAR(50),
  image_order INTEGER DEFAULT 0, -- 图片顺序
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
-- 小红书作品表索引
CREATE INDEX IF NOT EXISTS idx_xhs_posts_author_id ON rpa_xhs_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_xhs_posts_note_id ON rpa_xhs_posts(note_id);
CREATE INDEX IF NOT EXISTS idx_xhs_posts_publish_time ON rpa_xhs_posts(publish_time);
CREATE INDEX IF NOT EXISTS idx_xhs_posts_saved_at ON rpa_xhs_posts(saved_at);

-- 抖音作品表索引
CREATE INDEX IF NOT EXISTS idx_douyin_posts_author_id ON rpa_douyin_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_douyin_posts_aweme_id ON rpa_douyin_posts(aweme_id);
CREATE INDEX IF NOT EXISTS idx_douyin_posts_publish_time ON rpa_douyin_posts(publish_time);
CREATE INDEX IF NOT EXISTS idx_douyin_posts_saved_at ON rpa_douyin_posts(saved_at);

-- 微信文章表索引
CREATE INDEX IF NOT EXISTS idx_wechat_posts_account_id ON rpa_wechat_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_wechat_posts_publish_time ON rpa_wechat_posts(publish_time);
CREATE INDEX IF NOT EXISTS idx_wechat_posts_saved_at ON rpa_wechat_posts(saved_at);

-- 媒体资源表索引
CREATE INDEX IF NOT EXISTS idx_images_source ON rpa_images(source_platform, source_post_id);
CREATE INDEX IF NOT EXISTS idx_images_oss_url ON rpa_images(oss_url);
CREATE INDEX IF NOT EXISTS idx_videos_source ON rpa_videos(source_platform, source_post_id);
CREATE INDEX IF NOT EXISTS idx_videos_oss_url ON rpa_videos(oss_url);

-- 图片关联表索引
CREATE INDEX IF NOT EXISTS idx_post_images_post ON rpa_post_images(post_type, post_id);
CREATE INDEX IF NOT EXISTS idx_post_images_image ON rpa_post_images(image_id);