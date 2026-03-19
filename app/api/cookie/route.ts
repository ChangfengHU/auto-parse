import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// OPTIONS /api/cookie - 处理 CORS 预检请求（Chrome 插件需要）
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// GET /api/cookie - 检查服务器 Cookie 状态
export async function GET() {
  try {
    if (!fs.existsSync(COOKIE_FILE)) {
      return NextResponse.json({ valid: false, updatedAt: null }, { headers: CORS_HEADERS });
    }
    const data = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
    // 检查 sessionid 是否存在
    const valid = !!(data.cookie && data.cookie.includes('sessionid='));
    return NextResponse.json({ valid, updatedAt: data.updatedAt }, { headers: CORS_HEADERS });
  } catch {
    return NextResponse.json({ valid: false, updatedAt: null }, { headers: CORS_HEADERS });
  }
}

// POST /api/cookie - 接收插件推送的 Cookie 并保存
export async function POST(req: NextRequest) {
  try {
    const { cookie } = await req.json();
    if (!cookie || typeof cookie !== 'string') {
      return NextResponse.json({ error: '缺少 cookie 字段' }, { status: 400, headers: CORS_HEADERS });
    }
    if (!cookie.includes('sessionid=')) {
      return NextResponse.json({ error: 'cookie 中未包含 sessionid，请确认已登录抖音' }, { status: 400, headers: CORS_HEADERS });
    }

    const data = { cookie, updatedAt: Date.now() };
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2), 'utf-8');

    console.log('[cookie] 已更新 Cookie，时间：', new Date().toLocaleString());
    return NextResponse.json({ success: true, updatedAt: data.updatedAt }, { headers: CORS_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS_HEADERS });
  }
}
