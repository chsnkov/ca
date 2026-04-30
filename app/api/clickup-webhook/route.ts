import { NextRequest, NextResponse } from 'next/server';
import {
  getTask,
  syncParentStatusFromSubtasks,
  syncParentTask,
  syncTaskStatusFromDates,
  verifyWebhook,
} from '../../../lib/clickup';
import { getConfig, appendRun } from '../../../lib/store';

function isDateRelevantTaskUpdate(body: any) {
  if (body?.event !== 'taskUpdated') return false;
  const items = Array.isArray(body?.history_items) ? body.history_items : [];

  return items.some((item: any) => {
    const field = String(item?.field || item?.field_name || item?.custom_field?.name || '').trim().toLowerCase();
    return field === 'start_date' || field === 'due_date';
  });
}

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
    const isDateUpdateEvent = isDateRelevantTaskUpdate(body);

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

    if (event !== 'taskStatusUpdated' && !isDateUpdateEvent) {
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
      if (isDateUpdateEvent) {
        await appendRun({
          type: 'webhook',
          message: 'DATE STATUS SYNC: ignored root task',
          action: 'date_status_ignored_root_task',
          event,
          taskId,
          taskListId,
          taskName: task.name,
          status: task.status?.status,
          timestamp: Date.now(),
        });

        return NextResponse.json({ ok: true, ignored: 'root_task_date_update' });
      }

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
    const dateStatusResult = config?.dateStatusSyncEnabled === false
      ? {
          updated: 0,
          skipped: 0,
          ignored: 1,
          errors: 0,
          taskId: String(taskId),
          reason: 'date_status_sync_disabled',
        }
      : await syncTaskStatusFromDates(task);

    if (isDateUpdateEvent && config?.dateStatusSyncEnabled === false) {
      await appendRun({
        type: 'webhook',
        message: 'DATE STATUS SYNC: ignored (disabled)',
        action: 'date_status_ignored_disabled',
        event,
        taskId,
        parentId,
        taskName: task.name,
        status: task.status?.status,
        listId: taskListId,
        dateStatusResult,
        timestamp: Date.now(),
      });

      return NextResponse.json({ ok: true, ignored: 'date_status_sync_disabled', dateStatusResult });
    }

    const shouldSyncParent = event === 'taskStatusUpdated' || dateStatusResult.updated > 0;
    const result = shouldSyncParent
      ? await syncParentTask(parentId)
      : { updated: 0, skipped: 0, ignored: 1, errors: 0, reason: 'parent_sync_not_needed' };
    const parentStatusResult = shouldSyncParent
      ? config?.parentStatusSyncEnabled === false
        ? {
            updated: 0,
            skipped: 0,
            ignored: 1,
            errors: 0,
            parentId,
            reason: 'parent_status_sync_disabled',
          }
        : await syncParentStatusFromSubtasks(parentId)
      : {
          updated: 0,
          skipped: 0,
          ignored: 1,
          errors: 0,
          parentId,
          reason: 'parent_status_sync_not_needed',
        };

    await appendRun({
      type: 'webhook',
      message: isDateUpdateEvent ? 'DATE STATUS SYNC: success' : 'WEBHOOK SYNC: success',
      action: isDateUpdateEvent ? 'date_status_synced' : 'synced',
      event,
      taskId,
      parentId,
      taskName: task.name,
      status: task.status?.status,
      listId: taskListId,
      dateStatusResult,
      result,
      parentStatusResult,
      timestamp: Date.now(),
    });

    return NextResponse.json({
      ok: true,
      parentSynced: parentId,
      dateStatusResult,
      result,
      parentStatusResult,
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
