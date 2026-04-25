import { NextRequest, NextResponse } from 'next/server';
import { runScheduledSync } from '../../../lib/scheduler';

async function getToken(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const json = await req.json();
      return String(json?.token || '');
    } catch {
      return '';
    }
  }

  try {
    const form = await req.formData();
    return String(form.get('token') || '');
  } catch {
    return '';
  }
}

export async function POST(req: NextRequest) {
  const token = await getToken(req);

  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const result = await runScheduledSync();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
