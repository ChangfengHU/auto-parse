import { NextResponse } from 'next/server';
import { createXhsQr } from '@/lib/analysis/xhs-login-utils';

export async function GET() {
  try {
    const data = await createXhsQr();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Create XHS QR Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
