// Status-activity capture (independent of the sync engine).
//
// Logs EVERY status change of Animation subtasks as a task in a private
// reporting folder, so a native ClickUp dashboard can count every transition —
// including re-submissions after fixes, which the historical time_in_status
// API collapses. Optionally restrict to specific statuses via
// STATUS_ACTIVITY_STATUSES (comma-separated); empty = all.
//
// Layout: ONE shared list ("activity", auto-created inside the report folder —
// the Roboton folder itself, so the team's sharing applies and members can be
// natively assigned). Each event task: name = the shot (parent task name),
// assignee = the animator, due_date = event day, and the task's own native
// STATUS = the recorded status (the list inherits the folder's status set, so
// "to check"/"in progress" exist there). If the status is unknown to the list
// the task is created with the default status rather than lost; same for an
// assignee without access (ITEM_087) — created unassigned.

const API = 'https://api.clickup.com/api/v2';

// Where the "activity" report list lives: the Roboton folder, so animators
// have access and can be assigned to the event tasks.
const REPORT_FOLDER_ID = () => process.env.STATUS_ACTIVITY_REPORT_FOLDER_ID || '90189683135';
const ROBOTON_FOLDER_ID = () => process.env.STATUS_ACTIVITY_FOLDER_ID || '90189683135';
const ANIMATION_ITEM_ID = () => Number(process.env.STATUS_ACTIVITY_ITEM_ID || '1003');
// Custom task type stamped on the report tasks ("Debug").
const REPORT_ITEM_ID = () => Number(process.env.STATUS_ACTIVITY_REPORT_ITEM_ID || '1012');

// Comma-separated allowlist of statuses to track. Set to "*" to track ALL.
function statusAllowlist(): Set<string> | null {
  const raw = process.env.STATUS_ACTIVITY_STATUSES;
  if (!raw) return new Set(['to check', 'in progress']);
  if (raw.trim() === '*') return null;
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}
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

const REPORT_LIST_NAME = 'activity';

// The shared report list, resolved by name in the report folder (created if
// missing) so the structure self-heals after an accidental deletion.
let reportListCache: string | null = null;
async function reportListId(): Promise<string> {
  if (reportListCache) return reportListCache;
  const data = await req(`/folder/${REPORT_FOLDER_ID()}/list?archived=false`);
  const found = (data?.lists || []).find(
    (l: any) => String(l.name).toLowerCase() === REPORT_LIST_NAME,
  );
  if (found) {
    reportListCache = String(found.id);
    return reportListCache;
  }
  const created = await req(`/folder/${REPORT_FOLDER_ID()}/list`, {
    method: 'POST',
    body: JSON.stringify({ name: REPORT_LIST_NAME }),
  });
  reportListCache = String(created?.id);
  return reportListCache;
}

/**
 * If `taskId` is an Animation subtask entering a tracked status, append one
 * report task (named after the shot, tagged with the animator and the status)
 * to the shared list in the private report folder.
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
  const listId = await reportListId();
  const body: any = {
    name: shot,
    due_date: Date.now(),
    due_date_time: false,
    status: status.toLowerCase(),
    custom_item_id: REPORT_ITEM_ID(),
  };
  if (assigneeId) body.assignees = [Number(assigneeId)];

  // Degrade gracefully rather than lose the event: an assignee may lack list
  // access (ITEM_087) and a status may not exist in the list's status set.
  const attempts: Array<(b: any) => void> = [
    () => {},
    (b) => delete b.assignees,
    (b) => delete b.status,
  ];
  let lastErr: unknown;
  for (const strip of attempts) {
    strip(body);
    try {
      const created = await req(`/list/${listId}/task`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return {
        logged: created?.id,
        shot,
        assigneeId: body.assignees ? assigneeId : null,
        status: body.status ?? null,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
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
