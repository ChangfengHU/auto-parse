import fs from 'fs';
import path from 'path';

const MATERIALS_FILE = path.join(process.cwd(), '.materials.json');

export interface Material {
  id: string;           // 唯一 ID
  platform: string;     // douyin / xiaohongshu / tiktok
  mediaType?: 'video' | 'image';
  title: string;
  videoUrl: string;     // 原始视频地址
  ossUrl: string;       // OSS 永久地址
  coverUrl?: string;    // 封面图（可选）
  sourceUrl?: string;   // 原始资源地址（用于去重）
  sourceNoteId?: string; // 来源笔记 ID
  sourcePostUrl?: string; // 来源帖子链接
  relatedContentId?: string; // 关联作品素材库 ID
  relatedContentType?: 'xhs'; // 关联作品类型
  watermark?: boolean;
  parsedAt: number;     // 时间戳
  publishedAt?: number; // 最近一次发布时间
  lastTaskId?: string;  // 最近一次发布任务 ID
}

export interface MaterialsQueryOptions {
  kind?: 'all' | 'video' | 'image';
  page?: number;
  pageSize?: number;
  keyword?: string;
  linked?: 'all' | 'linked' | 'unlinked';
}

export interface MaterialsPageResult {
  items: Material[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function readAll(): Material[] {
  try {
    if (!fs.existsSync(MATERIALS_FILE)) return [];
    return JSON.parse(fs.readFileSync(MATERIALS_FILE, 'utf-8')) as Material[];
  } catch {
    return [];
  }
}

function writeAll(list: Material[]) {
  fs.writeFileSync(MATERIALS_FILE, JSON.stringify(list, null, 2));
}

/** 获取全部素材（最新在前） */
export function getMaterials(): Material[] {
  return readAll().sort((a, b) => b.parsedAt - a.parsedAt);
}

export function queryMaterials(options: MaterialsQueryOptions = {}): MaterialsPageResult {
  const kind = options.kind ?? 'video';
  const keyword = (options.keyword ?? '').trim().toLowerCase();
  const linked = options.linked ?? 'all';
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));

  const filtered = getMaterials().filter((m) => {
    if (keyword && !String(m.title || '').toLowerCase().includes(keyword)) return false;
    if (linked === 'linked' && !m.relatedContentId) return false;
    if (linked === 'unlinked' && m.relatedContentId) return false;
    if (kind === 'all') return true;
    if (kind === 'image') return m.mediaType === 'image';
    return (m.mediaType ?? 'video') === 'video';
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const normalizedPage = Math.min(page, totalPages);
  const start = (normalizedPage - 1) * pageSize;
  const end = start + pageSize;

  return {
    items: filtered.slice(start, end),
    total,
    page: normalizedPage,
    pageSize,
    totalPages,
  };
}

export function getMaterialById(id: string): Material | null {
  return readAll().find(m => m.id === id) ?? null;
}

export function getMaterialBySourceUrl(sourceUrl: string): Material | null {
  return readAll().find((m) => m.sourceUrl === sourceUrl) ?? null;
}

export function linkMaterialsBySourceNoteId(noteId: string, contentId: string) {
  if (!noteId || !contentId) return 0;
  const list = readAll();
  let linked = 0;
  for (const item of list) {
    if (item.sourceNoteId === noteId) {
      item.relatedContentId = contentId;
      item.relatedContentType = 'xhs';
      linked += 1;
    }
  }
  if (linked > 0) writeAll(list);
  return linked;
}

export function updateMaterialById(id: string, patch: Partial<Material>) {
  if (!id) return false;
  const list = readAll();
  const item = list.find((m) => m.id === id);
  if (!item) return false;
  Object.assign(item, patch);
  writeAll(list);
  return true;
}

/** 新增素材（OSS URL 相同则更新 title） */
export function addMaterial(item: Omit<Material, 'id' | 'parsedAt'>): Material {
  const list = readAll();
  const existing = list.find((m) => {
    if (item.sourceUrl && m.sourceUrl) return m.sourceUrl === item.sourceUrl;
    return m.ossUrl === item.ossUrl;
  });
  if (existing) {
    Object.assign(existing, {
      ...item,
      mediaType: item.mediaType ?? existing.mediaType ?? 'video',
      parsedAt: existing.parsedAt,
    });
    writeAll(list);
    return existing;
  }
  const newItem: Material = {
    mediaType: item.mediaType ?? 'video',
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    parsedAt: Date.now(),
  };
  list.unshift(newItem);
  writeAll(list);
  return newItem;
}

/** 标记素材已发布 */
export function markPublished(ossUrl: string, taskId: string) {
  const list = readAll();
  const item = list.find(m => m.ossUrl === ossUrl);
  if (item) {
    item.publishedAt = Date.now();
    item.lastTaskId = taskId;
    writeAll(list);
  }
}

/** 删除素材 */
export function deleteMaterial(id: string): boolean {
  const list = readAll();
  const idx = list.findIndex(m => m.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  writeAll(list);
  return true;
}
