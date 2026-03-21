import fs from 'fs';
import path from 'path';

const MATERIALS_FILE = path.join(process.cwd(), '.materials.json');

export interface Material {
  id: string;           // 唯一 ID
  platform: string;     // douyin / xiaohongshu / tiktok
  title: string;
  videoUrl: string;     // 原始视频地址
  ossUrl: string;       // OSS 永久地址
  coverUrl?: string;    // 封面图（可选）
  watermark?: boolean;
  parsedAt: number;     // 时间戳
  publishedAt?: number; // 最近一次发布时间
  lastTaskId?: string;  // 最近一次发布任务 ID
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

/** 新增素材（OSS URL 相同则更新 title） */
export function addMaterial(item: Omit<Material, 'id' | 'parsedAt'>): Material {
  const list = readAll();
  const existing = list.find(m => m.ossUrl === item.ossUrl);
  if (existing) {
    Object.assign(existing, { ...item, parsedAt: existing.parsedAt });
    writeAll(list);
    return existing;
  }
  const newItem: Material = {
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
