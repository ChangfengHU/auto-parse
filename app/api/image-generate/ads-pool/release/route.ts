import { NextRequest, NextResponse } from 'next/server';
import { releaseInstanceLease } from '@/lib/ads-instance-pool';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const instanceId = String(body.instanceId || '').trim();
    const leaseId = String(body.leaseId || '').trim();
    if (!instanceId) {
      return NextResponse.json({ error: 'instanceId 不能为空' }, { status: 400 });
    }
    const status = await releaseInstanceLease(instanceId, leaseId || undefined);
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
