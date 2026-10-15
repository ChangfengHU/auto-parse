import { NextRequest, NextResponse } from "next/server";
import {
  AUDIO_COOKIE,
  audioProxyError,
  audioUpstream,
  limitedJson,
  sameOrigin,
} from "@/lib/audio-studio-server";
export const runtime = "nodejs";
const operations = new Set([
  "capabilities",
  "search",
  "library",
  "get_asset",
  "quote",
  "generate",
  "import",
  "jobs",
  "update_asset",
  "review_asset",
  "use_asset",
]);
type Context = { params: Promise<{ path: string[] }> };
export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const token = request.cookies.get(AUDIO_COOKIE)?.value;
  if (!token)
    return NextResponse.json({ error: "请先连接私有工作室" }, { status: 401 });
  const { path } = await context.params;
  if (path.length !== 1 || !operations.has(path[0]))
    return NextResponse.json({ error: "接口不存在" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await limitedJson(request);
  } catch {
    return NextResponse.json({ error: "无效请求参数" }, { status: 400 });
  }
  try {
    const r = await audioUpstream(`/v1/${path[0]}`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return new Response(r.body, {
      status: r.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return audioProxyError();
  }
}
export async function GET(request: NextRequest, context: Context) {
  const token = request.cookies.get(AUDIO_COOKIE)?.value;
  if (!token)
    return NextResponse.json({ error: "请先连接私有工作室" }, { status: 401 });
  const { path } = await context.params;
  if (
    path.length !== 2 ||
    path[0] !== "media" ||
    !/^[a-f0-9-]{36}$/.test(path[1])
  )
    return NextResponse.json({ error: "媒体不存在" }, { status: 404 });
  const download =
    request.nextUrl.searchParams.get("download") === "1" ? "?download=1" : "";
  try {
    const headers: Record<string, string> = {};
    const range = request.headers.get("range");
    if (range) headers.Range = range;
    const r = await audioUpstream(`/v1/media/${path[1]}${download}`, token, {
      method: request.method,
      headers,
    });
    const result = new Headers({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const key of [
      "Content-Type",
      "Content-Length",
      "Content-Range",
      "Accept-Ranges",
      "Content-Disposition",
      "ETag",
    ]) {
      const value = r.headers.get(key);
      if (value) result.set(key, value);
    }
    return new Response(r.body, { status: r.status, headers: result });
  } catch {
    return audioProxyError();
  }
}
export const HEAD = GET;
