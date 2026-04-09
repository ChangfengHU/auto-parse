import { NextRequest, NextResponse } from 'next/server';
import { listInstanceStatuses, resolvePoolInstanceIds } from '@/lib/ads-instance-pool';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get('instanceIds') || '';
    const explicit = raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const instanceIds = resolvePoolInstanceIds(explicit);
    const instances = await listInstanceStatuses(instanceIds);
    return NextResponse.json({ instances });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
