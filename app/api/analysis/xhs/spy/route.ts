import { NextResponse } from 'next/server';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';
import { getXhsCliBridgeConfig, getXhsUserPostsByCli, getXhsUserProfileByCli } from '@/lib/analysis/xhs-cli-bridge';

export const runtime = 'nodejs';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: Request) {
  try {
    const { userId, cursor } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }
    const cookie = getXhsCookie() || '';
    const cliConfig = getXhsCliBridgeConfig();
    console.log(`[Spy API] Start spying on: ${userId}`);
    console.log(`[Spy API] Using Python CLI bridge: ${cliConfig.python}`);

    // 分步拉取博主档案与近期笔记（增强容错）
    let profileData: Record<string, unknown> | null = null;
    let notesData: Record<string, unknown> | null = null;

    try {
      profileData = await getXhsUserProfileByCli(cookie, userId);
    } catch (error: unknown) {
      console.error(`[Spy API] Profile fetch exception:`, errorMessage(error));
    }

    try {
      notesData = await getXhsUserPostsByCli(cookie, userId, typeof cursor === 'string' ? cursor : '');
    } catch (error: unknown) {
      console.error(`[Spy API] Notes fetch exception:`, errorMessage(error));
    }
    
    // 如果博主档案和笔记列表都完全拿不到（比如 Python 进程挂了）
    if (!profileData && !notesData) {
      return NextResponse.json({ 
        error: '获取博主信息失败', 
        detail: '可能是 Cookie 已失效、博主 ID 错误，或者 Python CLI 调用失败。' 
      }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        profile: profileData,
        notes: notesData,
      }
    });

  } catch (error: unknown) {
    console.error('XHS Spy API Error:', error);
    return NextResponse.json({ error: '系统内部错误', message: errorMessage(error) }, { status: 500 });
  }
}
