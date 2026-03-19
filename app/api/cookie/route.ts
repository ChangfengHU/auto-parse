import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');

// GET /api/cookie/status - 检查服务器 Cookie 状态
export async function GET() {
  try {
    if (!fs.existsSync(COOKIE_FILE)) {
      return NextResponse.json({ valid: false, updatedAt: null });
    }
    const data = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
    // 检查 sessionid 是否存在
    const valid = !!(data.cookie && data.cookie.includes('sessionid='));
    return NextResponse.json({ valid, updatedAt: data.updatedAt });
  } catch {
    return NextResponse.json({ valid: false, updatedAt: null });
  }
}

// POST /api/cookie - 接收插件推送的 Cookie 并保存
export async function POST(req: NextRequest) {
  try {
    const { cookie } = await req.json();
    if (!cookie || typeof cookie !== 'string') {
      return NextResponse.json({ error: '缺少 cookie 字段' }, { status: 400 });
    }
    if (!cookie.includes('sessionid=')) {
      return NextResponse.json({ error: 'cookie 中未包含 sessionid，请确认已登录抖音' }, { status: 400 });
    }

    const data = { cookie, updatedAt: Date.now() };
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2), 'utf-8');

    console.log('[cookie] 已更新 Cookie，时间：', new Date().toLocaleString());
    return NextResponse.json({ success: true, updatedAt: data.updatedAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
