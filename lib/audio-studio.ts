export interface StudioCapabilities {
  version: string;
  dailyBudgetUsd: number;
  reservedTodayUsd: number;
  rights: string;
  providers: { id: string; name: string; ready: boolean; note: string }[];
}
export interface StudioAsset {
  id: string;
  kind: "music" | "sound_effect";
  title: string;
  status: "candidate" | "approved" | "rejected";
  tags: string[];
  scene: string;
  mood: string;
  bpm: number | null;
  loop_verified: number;
  vocals: string;
  source: string;
  source_url: string;
  creator: string;
  license: string;
  license_url: string;
  attribution: string;
  rights_scope: string;
  rights_confirmed: number;
  quality_confirmed: number;
  prompt: string | null;
  model: string | null;
  cost_micros: number;
  sha256: string;
  mime: string;
  bytes: number;
  duration_ms: number;
  created_at: string;
  uses: number;
}
export interface StudioJob {
  id: string;
  operation: string;
  status: string;
  payload: { title?: string; sourceId?: string };
  reserved_micros: number;
  created_at: string;
  asset_id: string | null;
  error: string | null;
}
export interface AudioQuote {
  estimatedUsd: number;
  currency: string;
  basis: string;
  excludes: string;
  duration: string;
  rightsScope: string;
}
export class StudioError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function studioApi<T>(
  operation: string,
  body: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/audio/studio/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => {
    throw new StudioError('音频服务返回异常，请稍后重试；写入任务请保留原请求 ID 并先查询任务', response.status || 502);
  });
  if (!response.ok)
    throw new StudioError(data.error || "音频请求失败", response.status);
  return data as T;
}
export function mediaUrl(id: string, download = false) {
  return `/api/audio/studio/media/${id}${download ? "?download=1" : ""}`;
}
export function durationLabel(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export const jobLabels: Record<string, string> = {
  queued: "排队中",
  generating: "获取音频中",
  saving: "保存并校验中",
  completed: "已进入候选库",
  failed: "失败",
  needs_review: "结果待人工核对",
};
