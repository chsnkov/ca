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

function isCronRequest(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';

  if (cronSecret) {
    return authHeader === `Bearer ${cronSecret}`;
  }

  return (req.headers.get('user-agent') || '').includes('vercel-cron/1.0');
}

export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const result = await runScheduledSync();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function POST(req: NextRequest) {
  const token = await getToken(req);

  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const result = await runScheduledSync();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
