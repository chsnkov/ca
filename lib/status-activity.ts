// Status-activity capture (independent of the sync engine).
//
// Logs EVERY status change of Animation subtasks as a task in a private
// reporting folder, so a native ClickUp dashboard can count every transition —
// including re-submissions after fixes, which the historical time_in_status
// API collapses. Optionally restrict to specific statuses via
// STATUS_ACTIVITY_STATUSES (comma-separated); empty = all.
//
// Layout: one LIST per status (auto-created inside the report folder), and the
// animator is a TAG on the task. No assignees at all — assignment requires the
// member to have access to the list (ITEM_087), and the report folder lives in
// the owner's private space precisely so animators cannot see it. Tags and
// lists are also fully API-creatable, so the whole structure can be rebuilt
// with no manual UI setup.
//
// Task name = the shot (parent task name).

const API = 'https://api.clickup.com/api/v2';

// Private "Status Activity" folder in the owner's Personal space.
const REPORT_FOLDER_ID = () => process.env.STATUS_ACTIVITY_REPORT_FOLDER_ID || '901815475095';
const ROBOTON_FOLDER_ID = () => process.env.STATUS_ACTIVITY_FOLDER_ID || '90189683135';
const ANIMATION_ITEM_ID = () => Number(process.env.STATUS_ACTIVITY_ITEM_ID || '1003');

// Comma-separated allowlist of statuses to track. Unset => only "to check"
// (the owner wants just submissions; other statuses would keep spawning
// per-status lists in the report folder). Set to "*" to track ALL statuses.
function statusAllowlist(): Set<string> | null {
  const raw = process.env.STATUS_ACTIVITY_STATUSES;
  if (!raw) return new Set(['to check']);
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

// status name (lowercased) -> report list id, resolved/created on demand
const listCache = new Map<string, string>();
async function listIdForStatus(status: string): Promise<string> {
  const key = status.toLowerCase();
  const hit = listCache.get(key);
  if (hit) return hit;
  const data = await req(`/folder/${REPORT_FOLDER_ID()}/list?archived=false`);
  for (const l of data?.lists || []) {
    listCache.set(String(l.name).toLowerCase(), String(l.id));
  }
  const found = listCache.get(key);
  if (found) return found;
  const created = await req(`/folder/${REPORT_FOLDER_ID()}/list`, {
    method: 'POST',
    body: JSON.stringify({ name: key }),
  });
  const id = String(created?.id);
  listCache.set(key, id);
  return id;
}

/**
 * If `taskId` is an Animation subtask entering a tracked status, append one
 * report task (named after the shot, tagged with the animator) to the
 * per-status list in the private report folder.
 */
export async function logStatusActivity(taskId: string, newStatus: string, _actorId?: number) {
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

  const who = task?.assignees?.[0];
  const person = String(who?.username || who?.email || 'unassigned').toLowerCase();
  const listId = await listIdForStatus(status);
  const created = await req(`/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify({
      name: shot,
      due_date: Date.now(),
      due_date_time: false,
      tags: [person],
    }),
  });
  return { logged: created?.id, shot, person, listId };
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
