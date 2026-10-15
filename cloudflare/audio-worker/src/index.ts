import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { AudioError, inputs, type AudioEnv, type Operation } from "./schema";
import { assetById, errorResponse, execute } from "./core";
export { AudioJob } from "./workflow";

const descriptions: Record<Operation, string> = {
  capabilities:
    "查看真实已配置来源、生成模型、今日预算与内部使用限制。先查此工具，不假定所有模型可用。",
  search:
    "搜索 Openverse 或 Wikimedia 开放音频。只检索试听，不计费，不保证无人声、循环性或适用授权。",
  library:
    "优先搜索自己的私有 BGM / 音效库，可按标签、场景、类型、验收状态筛选。",
  get_asset:
    "读取一份私有音频的标签、时长、SHA256、来源、授权及受鉴权保护的媒体路径。",
  quote: "获取生成费用估算，不提交生成。先检索素材库，找不到合适内容再报价。",
  generate:
    "付费生成背景音乐或音效。必须用户确认费用、confirmPaid=true、maxCostUsd 和稳定 requestId。同 ID 重试不重复扣费；结果未知时不得换 ID 重发。只入候选区。",
  import:
    "从已核对授权的来源 ID 导入私有候选库。保存提供的文件字节、标签、来源及授权；Freesound 聚合文件可能是试听转码版本。",
  jobs: "查询持久化生成/导入任务。needs_review 表示结果不确定，需人工核对；不应自动重新付费。",
  update_asset:
    "编辑私有音频标题、用途、情绪、标签、BPM、是否有人声、是否人工验证循环。",
  review_asset:
    "人工验收音频；只有同时确认音质和当前用途授权才能 approved 入库。不会授予第三方分发权。",
  use_asset:
    "为已验收素材记录一次实际复用用途并返回鉴权下载路径。requestId 幂等。",
};
const writes = new Set<Operation>([
  "generate",
  "import",
  "update_asset",
  "review_asset",
  "use_asset",
]);
async function mcp(request: Request, env: AudioEnv) {
  const server = new McpServer(
    { name: "auto-parse-audio", version: "0.1.0" },
    {
      instructions:
        "优先复用已验收素材；其次检索授权素材；最后征得用户费用确认后生成。所有资产仅供当前所有者内部使用，不是公开素材库。",
    },
  );
  for (const name of Object.keys(inputs) as Operation[]) {
    server.registerTool(
      `audio_${name}`,
      {
        description: descriptions[name],
        inputSchema: inputs[name].shape,
        annotations: {
          readOnlyHint: !writes.has(name),
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: ["search", "import", "generate"].includes(name),
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await execute(env, name, args);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        } catch (error) {
          const response = errorResponse(error);
          return {
            isError: true,
            content: [{ type: "text" as const, text: await response.text() }],
          };
        }
      },
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}
async function media(request: Request, env: AudioEnv, id: string) {
  const asset = await assetById(env, id);
  const download = new URL(request.url).searchParams.get("download") === "1";
  if (download && asset.status !== "approved")
    throw new AudioError(409, "正式下载复用前请先验收入库");
  let offset = 0,
    length = asset.bytes;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${asset.bytes}` },
      });
    if (!match[1]) {
      length = Math.min(Number(match[2]), asset.bytes);
      offset = asset.bytes - length;
    } else {
      offset = Number(match[1]);
      const end = match[2]
        ? Math.min(Number(match[2]), asset.bytes - 1)
        : asset.bytes - 1;
      length = end - offset + 1;
    }
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      offset >= asset.bytes ||
      length <= 0
    )
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${asset.bytes}` },
      });
  }
  const obj = await env.AUDIO.get(asset.object_key, {
    range: { offset, length },
  });
  if (!obj) throw new AudioError(404, "文件不存在");
  const ext =
    asset.mime === "audio/wav"
      ? "wav"
      : asset.mime === "audio/ogg"
        ? "ogg"
        : asset.mime === "audio/flac"
          ? "flac"
          : "mp3";
  const headers = new Headers({
    "Content-Type": asset.mime,
    "Content-Length": String(length),
    "Accept-Ranges": "bytes",
    ETag: obj.httpEtag,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (range)
    headers.set(
      "Content-Range",
      `bytes ${offset}-${offset + length - 1}/${asset.bytes}`,
    );
  if (download)
    headers.set(
      "Content-Disposition",
      `attachment; filename="${asset.id}.${ext}"; filename*=UTF-8''${encodeURIComponent(asset.title)}.${ext}`,
    );
  return new Response(request.method === "HEAD" ? null : obj.body, {
    status: range ? 206 : 200,
    headers,
  });
}
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  let size = 0;
  const parts: Uint8Array[] = [];
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new AudioError(413, "请求过大");
    }
    parts.push(r.value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    all.set(p, offset);
    offset += p.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new AudioError(400, "JSON 格式错误");
  }
}
export default {
  async fetch(request: Request, env: AudioEnv): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET")
        return Response.json({
          ok: true,
          service: "auto-parse-audio",
          version: "0.1.0",
          auth: "bearer",
          assets: "private",
        });
      const origin = request.headers.get("origin");
      if (origin && origin !== env.ALLOWED_ORIGIN && origin !== url.origin)
        throw new AudioError(403, "Origin 不被允许");
      if (!env.AUDIO_ACCESS_TOKEN)
        throw new AudioError(503, "工作室尚未配置访问密钥");
      const actual = new TextEncoder().encode(
        request.headers.get("authorization") || "",
      );
      const expected = new TextEncoder().encode(
        `Bearer ${env.AUDIO_ACCESS_TOKEN}`,
      );
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return Response.json(
          { error: "需要工作室访问密钥" },
          {
            status: 401,
            headers: {
              "WWW-Authenticate": 'Bearer realm="audio-studio"',
              "Cache-Control": "no-store",
            },
          },
        );
      if (
        request.method === "POST" &&
        Number(request.headers.get("content-length")) > 16384
      )
        throw new AudioError(413, "请求过大");
      let response: Response;
      if (url.pathname === "/mcp") {
        if (request.method === "POST") {
          const parsed = await body(request);
          const headers = new Headers(request.headers);
          headers.delete("content-length");
          response = await mcp(
            new Request(request.url, {
              method: "POST",
              headers,
              body: JSON.stringify(parsed),
            }),
            env,
          );
        } else response = await mcp(request, env);
      } else if (
        /^\/v1\/media\/[a-f0-9-]{36}$/.test(url.pathname) &&
        ["GET", "HEAD"].includes(request.method)
      )
        response = await media(request, env, url.pathname.split("/").pop()!);
      else if (request.method === "POST" && url.pathname.startsWith("/v1/")) {
        const operation = url.pathname.slice(4);
        if (!Object.hasOwn(inputs, operation))
          throw new AudioError(404, "未知音频操作");
        response = Response.json(
          await execute(env, operation as Operation, await body(request)),
        );
      } else throw new AudioError(404, "接口不存在");
      const secured = new Response(response.body, response);
      secured.headers.set("Cache-Control", "private, no-store");
      secured.headers.set("X-Content-Type-Options", "nosniff");
      return secured;
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<AudioEnv>;
