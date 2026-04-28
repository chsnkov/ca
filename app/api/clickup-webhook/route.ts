import { NextRequest, NextResponse } from 'next/server';
import { getTask, syncParentTask, verifyWebhook } from '../../../lib/clickup';
import { getConfig, appendRun } from '../../../lib/store';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const webhookSecret = process.env.CLICKUP_WEBHOOK_SECRET;
    const signature =
      req.headers.get('x-signature') ||
      req.headers.get('x-clickup-signature') ||
      '';

    if (webhookSecret && !verifyWebhook(rawBody, webhookSecret, signature)) {
      await appendRun({
        type: 'webhook',
        message: 'WEBHOOK SYNC: unauthorized signature',
        action: 'unauthorized_signature',
        timestamp: Date.now(),
      });

      return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 });
    }

    const body = JSON.parse(rawBody);
    const config = await getConfig();

    const event = body.event;
    const taskId = body.task_id;

    if (config?.webhookSyncEnabled === false) {
      await appendRun({
        type: 'webhook',
        message: 'WEBHOOK SYNC: ignored (disabled)',
        action: 'ignored_disabled',
        event,
        taskId,
        timestamp: Date.now(),
      });

      return NextResponse.json({ ok: true, ignored: 'webhook_sync_disabled' });
    }

    if (event !== 'taskStatusUpdated') {
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (!taskId) {
      return NextResponse.json({ ok: false, error: 'no_task_id' });
    }

    const task = await getTask(String(taskId));

    const selectedListIds = config?.selectedListIds || [];

    const taskListId = String(task?.list?.id || '');

    if (selectedListIds.length && !selectedListIds.includes(taskListId)) {
      await appendRun({
        type: 'webhook',
        message: 'WEBHOOK SYNC: ignored (wrong list)',
        action: 'ignored_wrong_list',
        taskId,
        taskListId,
        selectedListIds,
        timestamp: Date.now(),
      });

      return NextResponse.json({ ok: true, ignored: 'wrong_list' });
    }

    if (!task.parent) {
      const result = await syncParentTask(String(task.id));

      await appendRun({
        type: 'webhook',
        message: 'WEBHOOK SYNC: parent task synced',
        action: 'synced_parent_task',
        taskId,
        taskListId,
        taskName: task.name,
        status: task.status?.status,
        result,
        timestamp: Date.now(),
      });

      return NextResponse.json({ ok: true, parentSynced: String(task.id), result });
    }

    const parentId = String(task.parent);

    const result = await syncParentTask(parentId);

    await appendRun({
      type: 'webhook',
      message: 'WEBHOOK SYNC: success',
      action: 'synced',
      taskId,
      parentId,
      taskName: task.name,
      status: task.status?.status,
      listId: taskListId,
      result,
      timestamp: Date.now(),
    });

    return NextResponse.json({
      ok: true,
      parentSynced: parentId,
      result,
    });
  } catch (err: any) {
    await appendRun({
      type: 'webhook',
      message: 'WEBHOOK SYNC: error',
      action: 'error',
      error: err?.message || 'unknown_error',
      timestamp: Date.now(),
    });

    return NextResponse.json({
      ok: false,
      error: err?.message || 'unknown_error',
    }, { status: 500 });
  }
}
