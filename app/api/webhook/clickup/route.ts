import { NextRequest, NextResponse } from 'next/server';
import { appendRun } from '../../../../lib/store';
import { getTask, syncParentTask, verifyWebhook } from '../../../../lib/clickup';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-signature') || '';
  const secret = process.env.CLICKUP_WEBHOOK_SECRET || '';

  if (secret) {
    const ok = verifyWebhook(rawBody, secret, signature);
    if (!ok) {
      await appendRun({
        type: 'webhook',
        ok: false,
        reason: 'invalid_signature',
        date: new Date().toISOString()
      });
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }
  }

  const payload = JSON.parse(rawBody || '{}');
  const event = payload?.event;
  const taskId = payload?.task_id ? String(payload.task_id) : '';

  if (event !== 'taskStatusUpdated' || !taskId) {
    await appendRun({
      type: 'webhook',
      ok: true,
      ignored: true,
      event,
      taskId,
      date: new Date().toISOString()
    });
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const task = await getTask(taskId);

    if (!task?.parent) {
      await appendRun({
        type: 'webhook',
        ok: true,
        ignored: true,
        reason: 'not_a_subtask',
        event,
        taskId,
        date: new Date().toISOString()
      });
      return NextResponse.json({ ok: true, ignored: true, reason: 'not_a_subtask' });
    }

    const parentId = String(task.parent);
    const parentTask = await getTask(parentId);

    if (parentTask?.parent) {
      await appendRun({
        type: 'webhook',
        ok: true,
        ignored: true,
        reason: 'nested_subtask',
        event,
        taskId,
        parentId,
        date: new Date().toISOString()
      });
      return NextResponse.json({ ok: true, ignored: true, reason: 'nested_subtask' });
    }

    const result = await syncParentTask(parentId);

    await appendRun({
      type: 'webhook',
      ok: true,
      event,
      taskId,
      parentId,
      result,
      date: new Date().toISOString()
    });

    return NextResponse.json({ ok: true, parentId, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';

    await appendRun({
      type: 'webhook',
      ok: false,
      event,
      taskId,
      error: message,
      date: new Date().toISOString()
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
