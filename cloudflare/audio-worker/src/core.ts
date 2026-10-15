import { z } from "zod";
import {
  AudioError,
  inputs,
  quote,
  sha256,
  type AudioEnv,
  type Operation,
} from "./schema";
import { searchSources } from "./sources";

export interface Job {
  id: string;
  operation: "generate" | "import";
  status: string;
  payload: string;
  reserved_micros: number;
  created_at: string;
  updated_at: string;
  request_hash: string;
  asset_id: string | null;
  error: string | null;
  receipt: string | null;
}
export interface Asset extends Record<string, unknown> {
  id: string;
  object_key: string;
  status: string;
  tags: string;
  title: string;
  mime: string;
  bytes: number;
  duration_ms: number;
  sha256: string;
}
export async function assetById(env: AudioEnv, id: string) {
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?")
    .bind(id)
    .first<Asset>();
  if (!asset) throw new AudioError(404, "素材不存在");
  return asset;
}
export function publicAsset(asset: Asset) {
  const { object_key: _key, ...rest } = asset;
  return {
    ...rest,
    tags: JSON.parse(asset.tags),
    mediaPath: `/v1/media/${asset.id}`,
    downloadPath: `/v1/media/${asset.id}?download=1`,
  };
}
function publicJob(job: Job) {
  const { receipt: _receipt, request_hash: _hash, ...rest } = job;
  // A killed provider step cannot be safely repeated. Surface this even before workflow cleanup.
  const stale =
    job.status === "generating" &&
    Date.now() - Date.parse(job.updated_at) > 12 * 60000;
  return {
    ...rest,
    payload: JSON.parse(job.payload),
    status: stale ? "needs_review" : job.status,
    error: stale
      ? "上游结果未确认；请核对账单，禁止换请求 ID 盲目重发"
      : job.error,
  };
}
async function ensureWorkflow(env: AudioEnv, id: string) {
  try {
    await env.JOBS.create({ id, params: { jobId: id } });
  } catch {
    try {
      await (await env.JOBS.get(id)).status();
    } catch {
      throw new AudioError(
        503,
        "任务已保存但调度暂不可用；使用相同 requestId 重试，不要新建付费请求",
      );
    }
  }
}
async function enqueue(
  env: AudioEnv,
  operation: "generate" | "import",
  payload: Record<string, unknown>,
  micros: number,
) {
  const requestId = String(payload.requestId);
  const hash = await sha256(JSON.stringify({ operation, payload }));
  const existing = await env.DB.prepare("SELECT * FROM jobs WHERE id=?")
    .bind(requestId)
    .first<Job>();
  if (existing) {
    if (existing.request_hash !== hash)
      throw new AudioError(409, "相同 requestId 不能用于不同参数");
    if (existing.status === "queued") await ensureWorkflow(env, requestId);
    return { job: publicJob(existing), reused: true };
  }
  const now = new Date().toISOString();
  const start = `${now.slice(0, 10)}T00:00:00.000Z`;
  const budget = Math.floor(Number(env.DAILY_BUDGET_USD) * 1e6);
  if (!Number.isFinite(budget) || budget < 0)
    throw new AudioError(503, "预算配置无效，生成已关闭");
  // One conditional INSERT is atomic in D1: parallel requests cannot over-reserve the daily budget.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO jobs(id,request_hash,operation,payload,reserved_micros,created_at,updated_at)
    SELECT ?,?,?,?,?,?,? WHERE
    COALESCE((SELECT SUM(reserved_micros) FROM jobs WHERE created_at>=?),0)+? <= ?
    AND (SELECT COUNT(*) FROM jobs WHERE created_at>=?) < 50
    AND (SELECT COUNT(*) FROM jobs WHERE status IN ('queued','generating','saving') AND updated_at>?) < 3`,
  )
    .bind(
      requestId,
      hash,
      operation,
      JSON.stringify(payload),
      micros,
      now,
      now,
      start,
      micros,
      budget,
      start,
      new Date(Date.now() - 12 * 60000).toISOString(),
    )
    .run();
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE id=?")
    .bind(requestId)
    .first<Job>();
  if (!job)
    throw new AudioError(
      429,
      "今日预算、任务数量或并发上限已达到；未知结果仍占用预算，请查看任务",
    );
  if (job.request_hash !== hash)
    throw new AudioError(409, "相同 requestId 不能用于不同参数");
  await ensureWorkflow(env, requestId);
  return { job: publicJob(job), reused: false };
}
export async function execute(
  env: AudioEnv,
  operation: Operation,
  raw: unknown,
): Promise<unknown> {
  // Parse again at the shared boundary: REST and MCP have identical validation and budget rules.
  if (operation === "capabilities") {
    inputs.capabilities.parse(raw);
    const row = await env.DB.prepare(
      "SELECT COALESCE(SUM(reserved_micros),0) AS reserved FROM jobs WHERE created_at>=?",
    )
      .bind(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
      .first<{ reserved: number }>();
    return {
      version: "0.1.0",
      scope: "owner_private",
      dailyBudgetUsd: Number(env.DAILY_BUDGET_USD),
      reservedTodayUsd: (row?.reserved || 0) / 1e6,
      providers: [
        {
          id: "openverse",
          name: "Openverse 聚合素材",
          ready: true,
          note: "含 Freesound / Jamendo 索引；试听版本，需核对授权",
        },
        {
          id: "wikimedia",
          name: "Wikimedia Commons",
          ready: true,
          note: "原始音频；需筛选相关性与授权",
        },
        {
          id: "freesound-direct",
          name: "Freesound 原始文件 API",
          ready: false,
          note: "尚未配置 OAuth；不把试听文件冒充原始 WAV",
        },
        {
          id: "jamendo-direct",
          name: "Jamendo 直连 API",
          ready: false,
          note: "尚未配置 client_id 与下载许可检查",
        },
        {
          id: "elevenlabs/music-v2",
          name: "CF · ElevenLabs Music v2",
          ready: true,
          note: "纯音乐；约 $0.15/分钟，需确认后提交",
        },
        {
          id: "minimax/music-2.6",
          name: "CF · MiniMax Music 2.6",
          ready: env.MINIMAX_ENABLED === "true",
          note:
            env.MINIMAX_ENABLED === "true"
              ? "约 $0.15/首，时长由模型决定"
              : "真实调用结果待核对，暂不开放付费重试",
        },
        {
          id: "elevenlabs/sound-effects",
          name: "ElevenLabs 独立音效",
          ready: !!env.ELEVENLABS_API_KEY && Number(env.SFX_COST_USD) > 0,
          note: "外部 API；需单独配置密钥与计费预留值",
        },
      ],
      workflow:
        "library → licensed sources → explicit paid fallback → candidate → review → reuse",
      rights:
        "私有内部资产库。授权信息需在来源页核实；生成不等于获得第三方素材分发权。MCP 不公开音频文件。",
    };
  }
  if (operation === "search") return searchSources(inputs.search.parse(raw));
  if (operation === "quote") return quote(inputs.quote.parse(raw), env);
  if (operation === "generate") {
    const input = inputs.generate.parse(raw);
    const price = quote(input, env);
    if (Math.round(input.maxCostUsd * 1e6) < price.micros)
      throw new AudioError(400, "确认费用小于本次预留费用，请重新报价");
    return enqueue(env, "generate", input, price.micros);
  }
  if (operation === "import")
    return enqueue(env, "import", inputs.import.parse(raw), 0);
  if (operation === "library") {
    const input = inputs.library.parse(raw);
    const q = `%${input.q}%`;
    const where = `WHERE (title LIKE ? OR tags LIKE ? OR scene LIKE ? OR mood LIKE ?) AND (?='' OR kind=?) AND (?='' OR status=?)`;
    const values = [
      q,
      q,
      q,
      q,
      input.kind || "",
      input.kind || "",
      input.status || "",
      input.status || "",
    ];
    const result = await env.DB.prepare(
      `SELECT * FROM assets ${where} ORDER BY created_at DESC LIMIT 24 OFFSET ?`,
    )
      .bind(...values, (input.page - 1) * 24)
      .all<Asset>();
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM assets ${where}`,
    )
      .bind(...values)
      .first<{ total: number }>();
    return {
      items: result.results.map(publicAsset),
      total: count?.total || 0,
      page: input.page,
    };
  }
  if (operation === "get_asset")
    return publicAsset(await assetById(env, inputs.get_asset.parse(raw).id));
  if (operation === "jobs") {
    const input = inputs.jobs.parse(raw);
    const jobs = input.id
      ? await env.DB.prepare("SELECT * FROM jobs WHERE id=?")
          .bind(input.id)
          .all<Job>()
      : await env.DB.prepare(
          "SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50",
        ).all<Job>();
    if (input.id && !jobs.results.length)
      throw new AudioError(404, "任务不存在");
    return { jobs: jobs.results.map(publicJob) };
  }
  if (operation === "update_asset") {
    const input = inputs.update_asset.parse(raw);
    await assetById(env, input.id);
    await env.DB.prepare(
      "UPDATE assets SET title=?,tags=?,scene=?,mood=?,bpm=?,vocals=?,loop_verified=? WHERE id=?",
    )
      .bind(
        input.title,
        JSON.stringify([...new Set(input.tags)]),
        input.scene,
        input.mood,
        input.bpm,
        input.vocals,
        input.loopVerified ? 1 : 0,
        input.id,
      )
      .run();
    return publicAsset(await assetById(env, input.id));
  }
  if (operation === "review_asset") {
    const input = inputs.review_asset.parse(raw);
    await assetById(env, input.id);
    if (
      input.decision === "approved" &&
      (!input.qualityConfirmed || !input.rightsConfirmed)
    )
      throw new AudioError(400, "正式入库前必须确认音质及当前用途授权");
    await env.DB.prepare(
      "UPDATE assets SET status=?,quality_confirmed=?,rights_confirmed=? WHERE id=?",
    )
      .bind(
        input.decision,
        input.qualityConfirmed ? 1 : 0,
        input.rightsConfirmed ? 1 : 0,
        input.id,
      )
      .run();
    return publicAsset(await assetById(env, input.id));
  }
  if (operation === "use_asset") {
    const input = inputs.use_asset.parse(raw);
    const asset = await assetById(env, input.id);
    if (asset.status !== "approved")
      throw new AudioError(409, "仅已验收素材允许正式复用");
    const previous = await env.DB.prepare(
      "SELECT asset_id,purpose FROM usage_events WHERE id=?",
    )
      .bind(input.requestId)
      .first<{ asset_id: string; purpose: string }>();
    if (
      previous &&
      (previous.asset_id !== input.id || previous.purpose !== input.purpose)
    )
      throw new AudioError(409, "复用记录 requestId 冲突");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO usage_events(id,asset_id,purpose,created_at) VALUES(?,?,?,?)",
      ).bind(
        input.requestId,
        input.id,
        input.purpose,
        new Date().toISOString(),
      ),
      env.DB.prepare(
        "UPDATE assets SET uses=(SELECT COUNT(*) FROM usage_events WHERE asset_id=?) WHERE id=?",
      ).bind(input.id, input.id),
    ]);
    const recorded = await env.DB.prepare("SELECT asset_id,purpose FROM usage_events WHERE id=?")
      .bind(input.requestId).first<{asset_id:string;purpose:string}>();
    if (!recorded || recorded.asset_id !== input.id || recorded.purpose !== input.purpose)
      throw new AudioError(409, "复用记录 requestId 冲突");
    return { asset: publicAsset(await assetById(env, input.id)), purpose: input.purpose };
  }
  throw new AudioError(404, "未知操作");
}
export function errorResponse(error: unknown) {
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: "参数不合法",
        details: error.issues.map((x) => ({
          path: x.path.join("."),
          message: x.message,
        })),
      },
      { status: 400 },
    );
  if (error instanceof AudioError)
    return Response.json({ error: error.message }, { status: error.status });
  // Never return upstream URLs, credentials, stack traces or provider response bodies.
  return Response.json(
    { error: "音频服务暂时不可用；请保留原请求 ID 并查看任务状态" },
    { status: 500 },
  );
}
