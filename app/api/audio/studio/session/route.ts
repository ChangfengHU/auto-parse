import { NextRequest, NextResponse } from "next/server";
import {
  AUDIO_COOKIE,
  audioProxyError,
  audioUpstream,
  limitedJson,
  sameOrigin,
} from "@/lib/audio-studio-server";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const token = request.cookies.get(AUDIO_COOKIE)?.value;
  if (!token)
    return NextResponse.json(
      { authenticated: false },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const response = await audioUpstream("/v1/capabilities", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok)
      return NextResponse.json(
        {
          authenticated: false,
          error:
            response.status === 401 ? "访问密钥已失效" : "无法连接音频后端",
        },
        { status: response.status },
      );
    return NextResponse.json(
      { authenticated: true, capabilities: await response.json() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return audioProxyError();
  }
}
export async function POST(request: NextRequest) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  let token: unknown;
  try {
    token = (await limitedJson(request)).token;
  } catch {
    return NextResponse.json({ error: "无效登录请求" }, { status: 400 });
  }
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,160}$/.test(token))
    return NextResponse.json({ error: "访问密钥格式不正确" }, { status: 400 });
  try {
    const upstream = await audioUpstream("/v1/capabilities", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!upstream.ok)
      return NextResponse.json(
        {
          error:
            upstream.status === 401 ? "访问密钥不正确" : "音频后端尚未就绪",
        },
        { status: upstream.status },
      );
    const response = NextResponse.json(
      { authenticated: true, capabilities: await upstream.json() },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(AUDIO_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 8 * 60 * 60,
      path: "/api/audio/studio",
    });
    return response;
  } catch {
    return audioProxyError();
  }
}
export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(AUDIO_COOKIE, "", {
    maxAge: 0,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/audio/studio",
  });
  return response;
}
