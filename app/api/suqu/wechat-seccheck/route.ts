import { NextRequest, NextResponse } from "next/server";

// 微信内容安全代理。必须放在 84 上:微信开放接口有 IP 白名单(155.103.255.246),
// 而 Cloudflare Worker 出口 IP 不固定,直连必然 -10008 invalid ip——
// 这与 wechat-code2session 走同一条代理链路,原因相同。
export const maxDuration = 30;

type SecCheckRequest = {
  appid?: string;
  secret?: string;
  kind?: "msg" | "img";
  content?: string;   // kind=msg
  openid?: string;    // kind=msg,必须是近两小时内访问过小程序的用户
  scene?: number;     // 1资料 2评论 3论坛 4社交日志
  imageBase64?: string; // kind=img
};

type TokenCache = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenCache>();

async function getStableToken(appid: string, secret: string): Promise<string> {
  const cached = tokenCache.get(appid);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  // stable_token 不会踢掉业务侧已有的 access_token,适合旁路调用
  const resp = await fetch("https://api.weixin.qq.com/cgi-bin/stable_token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credential", appid, secret, force_refresh: false }),
    cache: "no-store",
  });
  const data = (await resp.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
  if (!data.access_token) throw new Error(`token failed: ${data.errcode} ${data.errmsg}`);
  tokenCache.set(appid, { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000 });
  return data.access_token;
}

export async function POST(req: NextRequest) {
  const expectedToken = process.env.SUQU_WECHAT_PROXY_TOKEN || process.env.R2_UPLOAD_TOKEN || process.env.UPLOAD_TOKEN || "";
  const auth = req.headers.get("authorization") || "";
  if (!expectedToken || auth !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as SecCheckRequest;
  const appid = String(body.appid || "").trim();
  const secret = String(body.secret || "").trim();
  if (!appid || !secret) return NextResponse.json({ ok: false, message: "appid and secret are required" }, { status: 400 });

  let token: string;
  try {
    token = await getStableToken(appid, secret);
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "token error" }, { status: 502 });
  }

  const kind = body.kind === "img" ? "img" : "msg";

  if (kind === "msg") {
    const content = String(body.content || "").slice(0, 2500);
    if (!content) return NextResponse.json({ ok: false, message: "content is required" }, { status: 400 });
    const resp = await fetch(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 2,
        openid: body.openid || "",
        scene: body.scene ?? 2,
        content,
      }),
      cache: "no-store",
    });
    const data = await resp.json().catch(() => null);
    return NextResponse.json({ ok: true, kind, data });
  }

  const imageBase64 = String(body.imageBase64 || "");
  if (!imageBase64) return NextResponse.json({ ok: false, message: "imageBase64 is required" }, { status: 400 });
  const bytes = Buffer.from(imageBase64, "base64");
  if (bytes.length > 1024 * 1024) {
    return NextResponse.json({ ok: false, message: "image exceeds 1MB limit of img_sec_check" }, { status: 413 });
  }
  const form = new FormData();
  form.append("media", new Blob([bytes]), "check.jpg");
  const resp = await fetch(`https://api.weixin.qq.com/wxa/img_sec_check?access_token=${token}`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  const data = await resp.json().catch(() => null);
  return NextResponse.json({ ok: true, kind, data });
}
