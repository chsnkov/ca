export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { isRequestAuthenticated, unauthorizedRedirect } from '../../../lib/auth';
import { setupStatusActivityWebhook } from '../../../lib/status-activity';

// One-time (idempotent) registration of the status-activity webhook on the
// Roboton folder. Auth-protected like /api/setup-webhook.
export async function GET(req: NextRequest) {
  if (!isRequestAuthenticated(req)) return unauthorizedRedirect(req);
  try {
    const result = await setupStatusActivityWebhook(req.nextUrl.origin);
    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
