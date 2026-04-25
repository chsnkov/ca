export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { isRequestAuthenticated, unauthorizedRedirect } from '../../../lib/auth';
import { setupWebhooks } from '../../../lib/webhooks';

export async function GET(req: NextRequest) {
  if (!isRequestAuthenticated(req)) {
    return unauthorizedRedirect(req);
  }

  try {
    const result = await setupWebhooks(req.nextUrl.origin);
    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}

export async function POST(req: NextRequest) {
  if (!isRequestAuthenticated(req)) {
    return unauthorizedRedirect(req);
  }

  try {
    const result = await setupWebhooks(req.nextUrl.origin);
    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
