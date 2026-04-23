import { NextRequest, NextResponse } from 'next/server';
import { getTask, syncParentTask } from '../../../lib/clickup';
import { getConfig, appendRun } from '../../../lib/store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const event = body.event;
    const taskId = body.task_id;

    if (event !== 'taskStatusUpdated') {
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (!taskId) {
      return NextResponse.json({ ok: false, error: 'no_task_id' });
    }

    const task = await getTask(String(taskId));

    const config = await getConfig();
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
      await appendRun({
        type: 'webhook',
        message: 'WEBHOOK SYNC: ignored (not subtask)',
        action: 'ignored_not_subtask',
        taskId,
        taskListId,
        timestamp: Date.now(),
      });

      return NextResponse.json({ ok: true, ignored: 'not_subtask' });
    }

    const parentId = String(task.parent);

    await syncParentTask(parentId);

    await appendRun({
      type: 'webhook',
      message: 'WEBHOOK SYNC: success',
      action: 'synced',
      taskId,
      parentId,
      taskName: task.name,
      status: task.status?.status,
      listId: taskListId,
      timestamp: Date.now(),
    });

    return NextResponse.json({
      ok: true,
      parentSynced: parentId,
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
    });
  }
}
