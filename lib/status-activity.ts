// Status-activity capture (independent of the sync engine).
//
// Logs EVERY status change of Animation subtasks as a task in a dedicated
// reporting list (the Status field holds the new status), so a native ClickUp
// dashboard can count every transition — including re-submissions after fixes,
// which the historical time_in_status API collapses. Optionally restrict to
// specific statuses via STATUS_ACTIVITY_STATUSES (comma-separated); empty = all.
//
// Task name = the shot (parent task name). Assignee = the subtask's assignee
// (falls back to the actor who made the change, then to unassigned).

const API = 'https://api.clickup.com/api/v2';

const REPORT_LIST_ID = () => process.env.STATUS_ACTIVITY_LIST_ID || '901819282141';
const ROBOTON_FOLDER_ID = () => process.env.STATUS_ACTIVITY_FOLDER_ID || '90189683135';
const ANIMATION_ITEM_ID = () => Number(process.env.STATUS_ACTIVITY_ITEM_ID || '1003');

// Optional comma-separated allowlist of statuses to track. Empty => track ALL.
function statusAllowlist(): Set<string> | null {
  const raw = process.env.STATUS_ACTIVITY_STATUSES;
  if (!raw) return null;
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}
const STATUS_FIELD_NAME = 'Status';

function token() {
  const t = process.env.CLICKUP_TOKEN;
  if (!t) throw new Error('CLICKUP_TOKEN missing');
  return t;
}

function isTemporary(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function req(path: string, init?: RequestInit, attempt = 0): Promise<any> {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: token(),
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    if (attempt < 2 && isTemporary(res.status)) {
      await sleep(1000);
      return req(path, init, attempt + 1);
    }
    throw new Error(`ClickUp ${path} failed: ${res.status} ${text}`);
  }
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

/** Extract the new status from a taskStatusUpdated payload's history_items. */
export function newStatusFromWebhook(body: any): string | null {
  const items = Array.isArray(body?.history_items) ? body.history_items : [];
  for (const it of items) {
    if (String(it?.field || '').toLowerCase() === 'status') {
      const after = it?.after?.status ?? it?.after;
      if (after) return String(after);
    }
  }
  return null;
}

/** The user who performed the status change (the actor). */
export function actorFromWebhook(body: any): number | undefined {
  const items = Array.isArray(body?.history_items) ? body.history_items : [];
  const item = items.find((i: any) => String(i?.field || '').toLowerCase() === 'status');
  const id = item?.user?.id;
  return id ? Number(id) : undefined;
}

let statusFieldCache: string | null = null;
async function statusFieldId(): Promise<string> {
  if (statusFieldCache) return statusFieldCache;
  const data = await req(`/list/${REPORT_LIST_ID()}/field`);
  const f = (data?.fields || []).find((x: any) => x.name === STATUS_FIELD_NAME);
  if (!f) throw new Error(`custom field "${STATUS_FIELD_NAME}" not found on report list`);
  statusFieldCache = f.id;
  return f.id;
}

/**
 * If `taskId` is an Animation subtask entering the target status, append one
 * report task (named after the shot) to the reporting list.
 */
export async function logStatusActivity(taskId: string, newStatus: string, actorId?: number) {
  const status = String(newStatus || '').trim();
  if (!status) return { ignored: 'no_status' };
  const allow = statusAllowlist();
  if (allow && !allow.has(status.toLowerCase())) {
    return { ignored: 'status_not_tracked' };
  }
  const task = await req(`/task/${taskId}`);
  if (Number(task?.custom_item_id) !== ANIMATION_ITEM_ID()) {
    return { ignored: 'not_animation' };
  }

  // shot = parent (the Animation subtask hangs under a shot task)
  let shot = task?.name || '';
  if (task?.parent) {
    try {
      const parent = await req(`/task/${task.parent}`);
      shot = parent?.name || shot;
    } catch {
      /* keep fallback */
    }
  }

  const assigneeId = task?.assignees?.[0]?.id ?? actorId;
  const fieldId = await statusFieldId();
  const body: any = {
    name: shot,
    due_date: Date.now(),
    due_date_time: false,
    custom_fields: [{ id: fieldId, value: status }],
  };
  if (assigneeId) body.assignees = [Number(assigneeId)];

  try {
    const created = await req(`/list/${REPORT_LIST_ID()}/task`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { logged: created?.id, shot, assigneeId };
  } catch (err) {
    // assignee may lack list access (ITEM_087) -> still record it, unassigned
    if (body.assignees) {
      delete body.assignees;
      const created = await req(`/list/${REPORT_LIST_ID()}/task`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { logged: created?.id, shot, assigneeId: null, unassignedFallback: true };
    }
    throw err;
  }
}

/** Register a folder-level taskStatusUpdated webhook -> our endpoint (idempotent). */
export async function setupStatusActivityWebhook(origin: string) {
  const teams = await req('/team');
  const teamId = teams?.teams?.[0]?.id;
  if (!teamId) throw new Error('no_team_id');

  const endpoint = `${origin}/api/status-activity-webhook`;
  const existing = await req(`/team/${teamId}/webhook`);
  const deleted: string[] = [];
  for (const wh of existing?.webhooks || []) {
    if (wh.endpoint === endpoint) {
      await req(`/webhook/${wh.id}`, { method: 'DELETE' });
      deleted.push(String(wh.id));
    }
  }

  const payload: Record<string, unknown> = {
    endpoint,
    events: ['taskStatusUpdated'],
    folder_id: ROBOTON_FOLDER_ID(),
  };
  if (process.env.CLICKUP_WEBHOOK_SECRET) payload.secret = process.env.CLICKUP_WEBHOOK_SECRET;

  const created = await req(`/team/${teamId}/webhook`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    endpoint,
    folderId: ROBOTON_FOLDER_ID(),
    webhookId: created?.webhook?.id || created?.id,
    deletedWebhooks: deleted,
  };
}
