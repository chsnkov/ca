import { NextRequest, NextResponse } from 'next/server';
import { getTask, syncParentTask } from '../../../lib/clickup';

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

    if (!task.parent) {
      return NextResponse.json({ ok: true, ignored: 'not_subtask' });
    }

    const parentId = String(task.parent);

    await syncParentTask(parentId);

    return NextResponse.json({
      ok: true,
      parentSynced: parentId,
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err?.message || 'unknown_error',
    });
  }
}
