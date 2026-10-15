import { NextRequest, NextResponse } from "next/server";

export const AUDIO_COOKIE = "audio_studio_access";
// Only a non-secret endpoint is configured in Next. The CF account/provider credentials stay in CF.
export const AUDIO_BACKEND =
  process.env.AUDIO_STUDIO_URL ||
  "https://auto-parse-audio.2513120790.workers.dev";
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site")
    return false;
  const allowed = new Set([
    "https://auto-parse-v2.vyibc.com",
    "https://auto-parse-65.vyibc.com",
  ]);
  if (process.env.NODE_ENV !== "production")
    allowed.add(new URL(request.url).origin);
  return allowed.has(origin);
}
export async function limitedJson(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("需要 JSON 请求");
  const reader = request.body?.getReader();
  if (!reader) return {};
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new Error("请求超过 16 KiB");
    }
    chunks.push(result.value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  const value = JSON.parse(new TextDecoder().decode(all));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("无效参数");
  return value;
}
export async function audioUpstream(
  path: string,
  token: string,
  options: RequestInit = {},
) {
  return fetch(`${AUDIO_BACKEND}${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(45000),
  });
}
export function audioProxyError() {
  return NextResponse.json(
    {
      error:
        "音频后端暂时不可用；付费任务请保留请求 ID，先查看任务状态，不要重复新建",
    },
    { status: 502 },
  );
}
