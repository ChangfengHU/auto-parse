import { z } from "zod";

export class AudioError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const kind = z.enum(["music", "sound_effect"]);
const tags = z.array(z.string().trim().min(1).max(40)).max(20).default([]);
const id = z.string().uuid();
export const generation = z.object({
  model: z.enum([
    "elevenlabs/music-v2",
    "minimax/music-2.6",
    "elevenlabs/sound-effects",
  ]),
  prompt: z.string().trim().min(10).max(2000),
  title: z.string().trim().min(1).max(120),
  seconds: z.number().int().min(3).max(120).default(30),
  loop: z.boolean().default(false),
  tags,
});
export const inputs = {
  capabilities: z.object({}),
  search: z.object({
    q: z.string().trim().min(1).max(200),
    kind,
    provider: z.enum(["openverse", "wikimedia"]).default("wikimedia"),
    page: z.number().int().min(1).max(20).default(1),
    pageSize: z.number().int().min(1).max(24).default(12),
    length: z.enum(["", "shortest", "short", "medium", "long"]).default(""),
    license: z.enum(["", "commercial", "cc0"]).default("commercial"),
  }),
  library: z.object({
    q: z.string().max(200).default(""),
    kind: kind.optional(),
    status: z.enum(["candidate", "approved", "rejected"]).optional(),
    page: z.number().int().min(1).max(1000).default(1),
  }),
  get_asset: z.object({ id }),
  quote: generation,
  generate: generation.extend({
    requestId: id,
    confirmPaid: z.literal(true),
    maxCostUsd: z.number().positive().max(1),
  }),
  import: z.object({
    requestId: id,
    provider: z.enum(["openverse", "wikimedia"]),
    sourceId: z.string().min(1).max(255),
    kind,
    tags,
    rightsAcknowledged: z.literal(true),
  }),
  jobs: z.object({ id: id.optional() }),
  update_asset: z.object({
    id,
    title: z.string().trim().min(1).max(120),
    tags,
    scene: z.string().max(160).default(""),
    mood: z.string().max(80).default(""),
    bpm: z.number().int().min(20).max(300).nullable().default(null),
    vocals: z.enum(["unknown", "none", "present"]).default("unknown"),
    loopVerified: z.boolean().default(false),
  }),
  review_asset: z.object({
    id,
    decision: z.enum(["approved", "rejected", "candidate"]),
    qualityConfirmed: z.boolean(),
    rightsConfirmed: z.boolean(),
  }),
  use_asset: z.object({
    id,
    requestId: id,
    purpose: z.string().trim().min(1).max(200),
  }),
};
export type Operation = keyof typeof inputs;
export type GenerateInput = z.infer<typeof generation>;
export type Secrets = {
  AUDIO_ACCESS_TOKEN: string;
  ELEVENLABS_API_KEY?: string;
};
export type AudioEnv = Omit<
  Env,
  "MINIMAX_ENABLED" | "SFX_COST_USD" | "DAILY_BUDGET_USD" | "ALLOWED_ORIGIN"
> &
  Secrets & {
    MINIMAX_ENABLED: string;
    SFX_COST_USD: string;
    DAILY_BUDGET_USD: string;
    ALLOWED_ORIGIN: string;
  };
export function quote(
  input: GenerateInput,
  env: Pick<
    AudioEnv,
    "MINIMAX_ENABLED" | "ELEVENLABS_API_KEY" | "SFX_COST_USD"
  >,
) {
  if (input.loop && input.model !== "elevenlabs/sound-effects")
    throw new AudioError(400, "音乐不承诺无缝循环；请试听后人工标记");
  if (input.model === "minimax/music-2.6" && env.MINIMAX_ENABLED !== "true")
    throw new AudioError(503, "MiniMax 线路待验证，目前关闭");
  if (
    input.model === "elevenlabs/sound-effects" &&
    (!env.ELEVENLABS_API_KEY || !(Number(env.SFX_COST_USD) > 0))
  )
    throw new AudioError(503, "独立音效生成尚未配置密钥及计费上限");
  if (input.model === "elevenlabs/sound-effects" && input.seconds > 30)
    throw new AudioError(400, "音效最长 30 秒");
  const micros =
    input.model === "elevenlabs/music-v2"
      ? input.seconds * 2500
      : input.model === "minimax/music-2.6"
        ? 150000
        : Math.ceil(Number(env.SFX_COST_USD) * 1000000);
  return {
    micros,
    estimatedUsd: micros / 1000000,
    currency: "USD",
    basis:
      input.model === "elevenlabs/sound-effects"
        ? "configured_reservation"
        : "published_model_price",
    excludes: "充值手续费、存储及流量；实际费用以账单为准",
    duration:
      input.model === "minimax/music-2.6"
        ? "时长由模型决定"
        : `${input.seconds} 秒`,
    rightsScope: "internal_only",
  };
}
export async function sha256(value: string | Uint8Array): Promise<string> {
  const data =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", data as BufferSource),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function allowedAudioUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AudioError(400, "无效的媒体地址");
  }
  const allowed = [
    "cdn.freesound.org",
    "freesound.org",
    "upload.wikimedia.org",
    "prod-1.storage.jamendo.com",
    "prod-2.storage.jamendo.com",
    "mp3d.jamendo.com",
    "images.jamendo.com",
  ];
  const cf = /^[a-z0-9-]+\.[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(
    u.hostname,
  );
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    (!allowed.includes(u.hostname) && !cf)
  )
    throw new AudioError(400, "该媒体域名尚未纳入安全下载白名单");
  return u;
}
