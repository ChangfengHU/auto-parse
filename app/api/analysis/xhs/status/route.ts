/**
 * GET /api/analysis/xhs/status
 * 检查小红书登录状态
 */

import { NextResponse } from 'next/server';
import { isXhsLoggedIn } from '@/lib/persistent-browser';

export async function GET() {
  const loggedIn = await isXhsLoggedIn();
  return NextResponse.json({ loggedIn });
}
