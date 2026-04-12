import { NextResponse } from 'next/server';
import {
  getRuntimeBackendConfig,
  getRuntimeBackendConfigPath,
  resetRuntimeBackendConfig,
  saveRuntimeBackendConfig,
} from '@/lib/runtime/backend-config';

export const runtime = 'nodejs';

export async function GET() {
  const config = await getRuntimeBackendConfig();
  return NextResponse.json({
    ok: true,
    data: config,
    meta: {
      path: getRuntimeBackendConfigPath(),
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      xhs?: {
        source?: 'cli' | 'http';
        httpBaseUrl?: string;
        timeoutMs?: number;
      };
      adsDispatcher?: {
        maxQueueSize?: number;
      };
      browser?: {
        headless?: boolean;
      };
    };

    const config = await saveRuntimeBackendConfig(body);
    return NextResponse.json({
      ok: true,
      data: config,
      meta: {
        path: getRuntimeBackendConfigPath(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  const config = await resetRuntimeBackendConfig();
  return NextResponse.json({
    ok: true,
    data: config,
    meta: {
      path: getRuntimeBackendConfigPath(),
    },
  });
}
