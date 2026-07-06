export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhook } from '../../../lib/clickup';
import { actorFromWebhook, logStatusActivity, newStatusFromWebhook } from '../../../lib/status-activity';

// Receives ClickUp taskStatusUpdated events (registered on the Roboton folder)
// and logs Animation -> "to check" transitions into the reporting list.
// Independent of the sync webhook at /api/clickup-webhook.
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const secret = process.env.CLICKUP_WEBHOOK_SECRET;
    const signature =
      req.headers.get('x-signature') || req.headers.get('x-clickup-signature') || '';

    if (secret && !verifyWebhook(raw, secret, signature)) {
      return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 });
    }

    const body = JSON.parse(raw);
    if (body?.event !== 'taskStatusUpdated' || !body?.task_id) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const newStatus = newStatusFromWebhook(body) || '';
    const actorId = actorFromWebhook(body);
    const result = await logStatusActivity(String(body.task_id), newStatus, actorId);

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 });
  }
}
