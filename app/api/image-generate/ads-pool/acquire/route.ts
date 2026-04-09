import { NextRequest, NextResponse } from 'next/server';
import { acquireInstanceLease } from '@/lib/ads-instance-pool';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const instanceId = String(body.instanceId || '').trim();
    const jobId = String(body.jobId || '').trim() || `job-${Date.now()}`;
    if (!instanceId) {
      return NextResponse.json({ error: 'instanceId 不能为空' }, { status: 400 });
    }
    const result = await acquireInstanceLease(instanceId, jobId);
    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
