-- Supabase switch migration
-- Purpose:
-- 1) Create required tables/indexes on the new Supabase project.
-- 2) Migrate data from import schema (import.*) into production tables with idempotent upsert.
--
-- Usage:
-- - Run this file in the NEW Supabase project's SQL Editor (or psql).
-- - Before running data migration section, import old data into `import` schema tables
--   (same table names as below), e.g. `import.rpa_workflows`.
--
-- Notes:
-- - This script is safe to run multiple times.
-- - If a source table in `import` does not exist, that table is skipped.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- Core workflow tables used by current app flows
-- =========================================================

CREATE TABLE IF NOT EXISTS rpa_workflows (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  nodes       JSONB NOT NULL DEFAULT '[]'::JSONB,
  vars        JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gemini_ads_dispatcher_tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ,
  task_json JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS gemini_ads_dispatcher_tasks_status_idx
  ON gemini_ads_dispatcher_tasks(status);
CREATE INDEX IF NOT EXISTS gemini_ads_dispatcher_tasks_updated_at_idx
  ON gemini_ads_dispatcher_tasks(updated_at DESC);
CREATE INDEX IF NOT EXISTS gemini_ads_dispatcher_tasks_created_at_idx
  ON gemini_ads_dispatcher_tasks(created_at DESC);

CREATE TABLE IF NOT EXISTS gemini_task_traces (
  id BIGSERIAL PRIMARY KEY,
  namespace TEXT NOT NULL,
  task_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  event TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS gemini_task_traces_task_ts_idx
  ON gemini_task_traces(namespace, task_id, ts);

-- =========================================================
-- RPA content tables
-- =========================================================

CREATE TABLE IF NOT EXISTS rpa_xhs_posts (
  id VARCHAR(50) PRIMARY KEY,
  note_id VARCHAR(50) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  author_name VARCHAR(100),
  author_id VARCHAR(50),
  author_avatar VARCHAR(500),
  author_level VARCHAR(20),
  tags JSONB,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  collect_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  original_url VARCHAR(500),
  cover_image_id VARCHAR(50),
  location VARCHAR(100),
  publish_time TIMESTAMPTZ,
  parsed_at TIMESTAMPTZ DEFAULT NOW(),
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
  video_id VARCHAR(50),
  cover_image_id VARCHAR(50),
  duration INTEGER,
  publish_time TIMESTAMPTZ,
  parsed_at TIMESTAMPTZ DEFAULT NOW(),
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
  cover_image_id VARCHAR(50),
  publish_time TIMESTAMPTZ,
  parsed_at TIMESTAMPTZ DEFAULT NOW(),
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rpa_images (
  id VARCHAR(50) PRIMARY KEY,
  original_url VARCHAR(500),
  oss_url VARCHAR(500),
  local_path VARCHAR(500),
  filename VARCHAR(255),
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  format VARCHAR(10),
  source_platform VARCHAR(20),
  source_post_type VARCHAR(20),
  source_post_id VARCHAR(50),
  image_type VARCHAR(20),
  upload_status VARCHAR(20) DEFAULT 'pending',
  upload_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rpa_videos (
  id VARCHAR(50) PRIMARY KEY,
  original_url VARCHAR(500),
  oss_url VARCHAR(500),
  local_path VARCHAR(500),
  filename VARCHAR(255),
  file_size INTEGER,
  duration INTEGER,
  width INTEGER,
  height INTEGER,
  format VARCHAR(10),
  bitrate INTEGER,
  fps INTEGER,
  has_watermark BOOLEAN DEFAULT FALSE,
  source_platform VARCHAR(20),
  source_post_type VARCHAR(20),
  source_post_id VARCHAR(50),
  upload_status VARCHAR(20) DEFAULT 'pending',
  upload_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rpa_post_images (
  id VARCHAR(50) PRIMARY KEY,
  post_type VARCHAR(20),
  post_id VARCHAR(50),
  image_id VARCHAR(50),
  image_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rpa_xhs_comments (
  id VARCHAR(50) PRIMARY KEY,
  post_id VARCHAR(50) NOT NULL,
  note_id VARCHAR(50),
  xhs_comment_id VARCHAR(50),
  nickname VARCHAR(100),
  avatar VARCHAR(500),
  content TEXT,
  like_count INTEGER DEFAULT 0,
  sub_comment_count INTEGER DEFAULT 0,
  comment_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_xhs_posts_author_id ON rpa_xhs_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_xhs_posts_note_id ON rpa_xhs_posts(note_id);
CREATE INDEX IF NOT EXISTS idx_xhs_posts_publish_time ON rpa_xhs_posts(publish_time);
CREATE INDEX IF NOT EXISTS idx_xhs_posts_saved_at ON rpa_xhs_posts(saved_at);

CREATE INDEX IF NOT EXISTS idx_douyin_posts_author_id ON rpa_douyin_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_douyin_posts_aweme_id ON rpa_douyin_posts(aweme_id);
CREATE INDEX IF NOT EXISTS idx_douyin_posts_publish_time ON rpa_douyin_posts(publish_time);
CREATE INDEX IF NOT EXISTS idx_douyin_posts_saved_at ON rpa_douyin_posts(saved_at);

CREATE INDEX IF NOT EXISTS idx_wechat_posts_account_id ON rpa_wechat_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_wechat_posts_publish_time ON rpa_wechat_posts(publish_time);
CREATE INDEX IF NOT EXISTS idx_wechat_posts_saved_at ON rpa_wechat_posts(saved_at);

CREATE INDEX IF NOT EXISTS idx_images_source ON rpa_images(source_platform, source_post_id);
CREATE INDEX IF NOT EXISTS idx_images_oss_url ON rpa_images(oss_url);
CREATE INDEX IF NOT EXISTS idx_videos_source ON rpa_videos(source_platform, source_post_id);
CREATE INDEX IF NOT EXISTS idx_videos_oss_url ON rpa_videos(oss_url);

CREATE INDEX IF NOT EXISTS idx_post_images_post ON rpa_post_images(post_type, post_id);
CREATE INDEX IF NOT EXISTS idx_post_images_image ON rpa_post_images(image_id);

CREATE INDEX IF NOT EXISTS idx_xhs_comments_post_id ON rpa_xhs_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_xhs_comments_note_id ON rpa_xhs_comments(note_id);

-- keep behavior consistent with current server-side service-role access.
ALTER TABLE rpa_workflows DISABLE ROW LEVEL SECURITY;
ALTER TABLE gemini_ads_dispatcher_tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE gemini_task_traces DISABLE ROW LEVEL SECURITY;
ALTER TABLE rpa_xhs_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE rpa_douyin_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE rpa_wechat_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE rpa_images DISABLE ROW LEVEL SECURITY;
ALTER TABLE rpa_videos DISABLE ROW LEVEL SECURITY;
ALTER TABLE rpa_post_images DISABLE ROW LEVEL SECURITY;
ALTER TABLE rpa_xhs_comments DISABLE ROW LEVEL SECURITY;

COMMIT;

-- =========================================================
-- Data migration section (source: import schema)
-- =========================================================

CREATE SCHEMA IF NOT EXISTS import;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='import' AND table_name='rpa_workflows') THEN
    INSERT INTO rpa_workflows (id, name, description, nodes, vars, created_at, updated_at)
    SELECT id, name, description, nodes, vars, created_at, updated_at
    FROM import.rpa_workflows
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      nodes = EXCLUDED.nodes,
      vars = EXCLUDED.vars,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='import' AND table_name='gemini_ads_dispatcher_tasks') THEN
    INSERT INTO gemini_ads_dispatcher_tasks (id, status, created_at, updated_at, last_activity_at, task_json)
    SELECT id, status, created_at, updated_at, last_activity_at, task_json
    FROM import.gemini_ads_dispatcher_tasks
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at,
      last_activity_at = EXCLUDED.last_activity_at,
      task_json = EXCLUDED.task_json;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='import' AND table_name='gemini_task_traces') THEN
    INSERT INTO gemini_task_traces (namespace, task_id, ts, event, payload)
    SELECT namespace, task_id, ts, event, payload
    FROM import.gemini_task_traces;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='import' AND table_name='rpa_xhs_posts') THEN
    INSERT INTO rpa_xhs_posts (
      id, note_id, title, content, author_name, author_id, author_avatar, author_level, tags,
      like_count, comment_count, share_count, collect_count, view_count, original_url, cover_image_id,
      location, publish_time, parsed_at, saved_at, updated_at
    )
    SELECT
      id, note_id, title, content, author_name, author_id, author_avatar, author_level, tags,
      like_count, comment_count, share_count, collect_count, view_count, original_url, cover_image_id,
      location, publish_time, parsed_at, saved_at, updated_at
    FROM import.rpa_xhs_posts
    ON CONFLICT (id) DO UPDATE SET
      note_id = EXCLUDED.note_id,
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      author_name = EXCLUDED.author_name,
      author_id = EXCLUDED.author_id,
      author_avatar = EXCLUDED.author_avatar,
      author_level = EXCLUDED.author_level,
      tags = EXCLUDED.tags,
      like_count = EXCLUDED.like_count,
      comment_count = EXCLUDED.comment_count,
      share_count = EXCLUDED.share_count,
      collect_count = EXCLUDED.collect_count,
      view_count = EXCLUDED.view_count,
      original_url = EXCLUDED.original_url,
      cover_image_id = EXCLUDED.cover_image_id,
      location = EXCLUDED.location,
      publish_time = EXCLUDED.publish_time,
      parsed_at = EXCLUDED.parsed_at,
      saved_at = EXCLUDED.saved_at,
      updated_at = EXCLUDED.updated_at;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='import' AND table_name='rpa_douyin_posts') THEN
    INSERT INTO rpa_douyin_posts (
      id, aweme_id, title, description, author_name, author_id, author_avatar, author_signature,
      music_title, music_author, like_count, comment_count, share_count, collect_count, play_count,
      original_url, video_id, cover_image_id, duration, publish_time, parsed_at, saved_at, updated_at
    )
    SELECT
      id, aweme_id, title, description, author_name, author_id, author_avatar, author_signature,
      music_title, music_author, like_count, comment_count, share_count, collect_count, play_count,
      original_url, video_id, cover_image_id, duration, publish_time, parsed_at, saved_at, updated_at
    FROM import.rpa_douyin_posts
    ON CONFLICT (id) DO UPDATE SET
      aweme_id = EXCLUDED.aweme_id,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      author_name = EXCLUDED.author_name,
      author_id = EXCLUDED.author_id,
      author_avatar = EXCLUDED.author_avatar,
      author_signature = EXCLUDED.author_signature,
      music_title = EXCLUDED.music_title,
      music_author = EXCLUDED.music_author,
      like_count = EXCLUDED.like_count,
      comment_count = EXCLUDED.comment_count,
      share_count = EXCLUDED.share_count,
      collect_count = EXCLUDED.collect_count,
      play_count = EXCLUDED.play_count,
      original_url = EXCLUDED.original_url,
      video_id = EXCLUDED.video_id,
      cover_image_id = EXCLUDED.cover_image_id,
      duration = EXCLUDED.duration,
      publish_time = EXCLUDED.publish_time,
      parsed_at = EXCLUDED.parsed_at,
      saved_at = EXCLUDED.saved_at,
      updated_at = EXCLUDED.updated_at;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='import' AND table_name='rpa_wechat_posts') THEN
    INSERT INTO rpa_wechat_posts (
      id, article_id, title, content, summary, author_name, account_name, account_id, read_count,
      like_count, comment_count, original_url, cover_image_id, publish_time, parsed_at, saved_at, updated_at
    )
    SELECT
      id, article_id, title, content, summary, author_name, account_name, account_id, read_count,
      like_count, comment_count, original_url, cover_image_id, publish_time, parsed_at, saved_at, updated_at
    FROM import.rpa_wechat_posts
    ON CONFLICT (id) DO UPDATE SET
      article_id = EXCLUDED.article_id,
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      summary = EXCLUDED.summary,
      author_name = EXCLUDED.author_name,
      account_name = EXCLUDED.account_name,
      account_id = EXCLUDED.account_id,
      read_count = EXCLUDED.read_count,
      like_count = EXCLUDED.like_count,
      comment_count = EXCLUDED.comment_count,
      original_url = EXCLUDED.original_url,
      cover_image_id = EXCLUDED.cover_image_id,
      publish_time = EXCLUDED.publish_time,
      parsed_at = EXCLUDED.parsed_at,
      saved_at = EXCLUDED.saved_at,
      updated_at = EXCLUDED.updated_at;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='import' AND table_name='rpa_images') THEN
    INSERT INTO rpa_images (
      id, original_url, oss_url, local_path, filename, file_size, width, height, format, source_platform,
      source_post_type, source_post_id, image_type, upload_status, upload_at, created_at, updated_at
    )
    SELECT
      id, original_url, oss_url, local_path, filename, file_size, width, height, format, source_platform,
      source_post_type, source_post_id, image_type, upload_status, upload_at, created_at, updated_at
    FROM import.rpa_images
    ON CONFLICT (id) DO UPDATE SET
      original_url = EXCLUDED.original_url,
      oss_url = EXCLUDED.oss_url,
      local_path = EXCLUDED.local_path,
      filename = EXCLUDED.filename,
      file_size = EXCLUDED.file_size,
      width = EXCLUDED.width,
      height = EXCLUDED.height,
      format = EXCLUDED.format,
      source_platform = EXCLUDED.source_platform,
      source_post_type = EXCLUDED.source_post_type,
      source_post_id = EXCLUDED.source_post_id,
      image_type = EXCLUDED.image_type,
      upload_status = EXCLUDED.upload_status,
      upload_at = EXCLUDED.upload_at,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='import' AND table_name='rpa_videos') THEN
    INSERT INTO rpa_videos (
      id, original_url, oss_url, local_path, filename, file_size, duration, width, height, format, bitrate,
      fps, has_watermark, source_platform, source_post_type, source_post_id, upload_status, upload_at, created_at, updated_at
    )
    SELECT
      id, original_url, oss_url, local_path, filename, file_size, duration, width, height, format, bitrate,
      fps, has_watermark, source_platform, source_post_type, source_post_id, upload_status, upload_at, created_at, updated_at
    FROM import.rpa_videos
    ON CONFLICT (id) DO UPDATE SET
      original_url = EXCLUDED.original_url,
      oss_url = EXCLUDED.oss_url,
      local_path = EXCLUDED.local_path,
      filename = EXCLUDED.filename,
      file_size = EXCLUDED.file_size,
      duration = EXCLUDED.duration,
      width = EXCLUDED.width,
      height = EXCLUDED.height,
      format = EXCLUDED.format,
      bitrate = EXCLUDED.bitrate,
      fps = EXCLUDED.fps,
      has_watermark = EXCLUDED.has_watermark,
      source_platform = EXCLUDED.source_platform,
      source_post_type = EXCLUDED.source_post_type,
      source_post_id = EXCLUDED.source_post_id,
      upload_status = EXCLUDED.upload_status,
      upload_at = EXCLUDED.upload_at,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='import' AND table_name='rpa_post_images') THEN
    INSERT INTO rpa_post_images (id, post_type, post_id, image_id, image_order, created_at)
    SELECT id, post_type, post_id, image_id, image_order, created_at
    FROM import.rpa_post_images
    ON CONFLICT (id) DO UPDATE SET
      post_type = EXCLUDED.post_type,
      post_id = EXCLUDED.post_id,
      image_id = EXCLUDED.image_id,
      image_order = EXCLUDED.image_order,
      created_at = EXCLUDED.created_at;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='import' AND table_name='rpa_xhs_comments') THEN
    INSERT INTO rpa_xhs_comments (
      id, post_id, note_id, xhs_comment_id, nickname, avatar, content, like_count,
      sub_comment_count, comment_index, created_at, updated_at
    )
    SELECT
      id, post_id, note_id, xhs_comment_id, nickname, avatar, content, like_count,
      sub_comment_count, comment_index, created_at, updated_at
    FROM import.rpa_xhs_comments
    ON CONFLICT (id) DO UPDATE SET
      post_id = EXCLUDED.post_id,
      note_id = EXCLUDED.note_id,
      xhs_comment_id = EXCLUDED.xhs_comment_id,
      nickname = EXCLUDED.nickname,
      avatar = EXCLUDED.avatar,
      content = EXCLUDED.content,
      like_count = EXCLUDED.like_count,
      sub_comment_count = EXCLUDED.sub_comment_count,
      comment_index = EXCLUDED.comment_index,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at;
  END IF;
END $$;

-- Validation query examples:
-- SELECT 'rpa_workflows' AS table_name, count(*) FROM rpa_workflows
-- UNION ALL SELECT 'gemini_ads_dispatcher_tasks', count(*) FROM gemini_ads_dispatcher_tasks
-- UNION ALL SELECT 'gemini_task_traces', count(*) FROM gemini_task_traces
-- UNION ALL SELECT 'rpa_xhs_posts', count(*) FROM rpa_xhs_posts
-- UNION ALL SELECT 'rpa_douyin_posts', count(*) FROM rpa_douyin_posts
-- UNION ALL SELECT 'rpa_wechat_posts', count(*) FROM rpa_wechat_posts
-- UNION ALL SELECT 'rpa_images', count(*) FROM rpa_images
-- UNION ALL SELECT 'rpa_videos', count(*) FROM rpa_videos
-- UNION ALL SELECT 'rpa_post_images', count(*) FROM rpa_post_images
-- UNION ALL SELECT 'rpa_xhs_comments', count(*) FROM rpa_xhs_comments;
