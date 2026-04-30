import crypto from 'crypto';

const API = 'https://api.clickup.com/api/v2';
const PAGE_SIZE = 100;

export type SyncTotals = {
  updated: number;
  skipped: number;
  ignored: number;
  errors: number;
  details?: any[];
};

type FieldCache = Map<string, any[]>;

type ClickUpTask = {
  id: string;
  name: string;
  status?: { status?: string };
  parent?: string | null;
  list?: { id?: string };
  start_date?: string | number | null;
  due_date?: string | number | null;
  date_updated?: string | number | null;
  custom_fields?: any[];
};

function token() {
  if (!process.env.CLICKUP_TOKEN) throw new Error('CLICKUP_TOKEN missing');
  return process.env.CLICKUP_TOKEN;
}

async function req(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: token(),
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickUp ${path} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function norm(s: string) {
  return (s || '').toLowerCase().trim();
}

function normStatus(status: unknown) {
  return String(status || '').trim().toUpperCase();
}

const PARENT_STATUS_PLANNED = 'PLANNED';
const PARENT_STATUS_TO_DO = 'TO DO';
const PARENT_STATUS_IN_PROGRESS = 'IN PROGRESS';
const PARENT_STATUS_COMPLETE = 'COMPLETE';
const PARENT_STATUS_PAUSED = 'PAUSED';
const PARENT_STATUS_FIX = 'FIX';
const PARENT_STATUS_TO_CHECK = 'TO CHECK';

const PARENT_STATUS_WORKING_STATUSES = new Set([
  PARENT_STATUS_IN_PROGRESS,
  PARENT_STATUS_FIX,
  PARENT_STATUS_TO_CHECK,
]);
const PARENT_STATUS_TRACKED_STATUSES = new Set([
  PARENT_STATUS_PLANNED,
  PARENT_STATUS_TO_DO,
  PARENT_STATUS_IN_PROGRESS,
  PARENT_STATUS_FIX,
  PARENT_STATUS_TO_CHECK,
  PARENT_STATUS_COMPLETE,
]);

const DATE_STATUS_IGNORED_STATUSES = new Set([
  PARENT_STATUS_IN_PROGRESS,
  PARENT_STATUS_FIX,
  PARENT_STATUS_TO_CHECK,
  PARENT_STATUS_COMPLETE,
  'CANCELED',
  'NO NEED',
]);

function getParentStatusDecision(subtasks: ClickUpTask[]) {
  const counts: Record<string, number> = {};

  for (const subtask of subtasks) {
    const status = normStatus(subtask.status?.status);
    if (!PARENT_STATUS_TRACKED_STATUSES.has(status)) continue;
    counts[status] = (counts[status] || 0) + 1;
  }

  const statuses = Object.keys(counts);
  if (!statuses.length) {
    return {
      desiredStatus: null,
      reason: 'no_tracked_first_level_subtasks',
      counts,
    };
  }

  const workingStatuses = statuses.filter((status) => PARENT_STATUS_WORKING_STATUSES.has(status));

  if (workingStatuses.length === 1 && workingStatuses[0] !== PARENT_STATUS_IN_PROGRESS) {
    return {
      desiredStatus: workingStatuses[0],
      reason: `single_${workingStatuses[0].toLowerCase().replace(/\s+/g, '_')}_subtask_status`,
      counts,
    };
  }

  if (workingStatuses.length) {
    return {
      desiredStatus: PARENT_STATUS_IN_PROGRESS,
      reason: 'working_subtask_status',
      counts,
    };
  }

  const onlyPlannedToDoAndComplete = statuses.every((status) =>
    status === PARENT_STATUS_PLANNED ||
    status === PARENT_STATUS_TO_DO ||
    status === PARENT_STATUS_COMPLETE,
  );
  if (onlyPlannedToDoAndComplete && counts[PARENT_STATUS_COMPLETE] && counts[PARENT_STATUS_TO_DO]) {
    return {
      desiredStatus: PARENT_STATUS_TO_DO,
      reason: 'complete_with_to_do',
      counts,
    };
  }

  if (onlyPlannedToDoAndComplete && counts[PARENT_STATUS_COMPLETE] && counts[PARENT_STATUS_PLANNED]) {
    return {
      desiredStatus: PARENT_STATUS_PAUSED,
      reason: 'complete_with_planned',
      counts,
    };
  }

  if (statuses.length === 1) {
    const onlyStatus = statuses[0];
    return {
      desiredStatus: onlyStatus,
      reason: `all_${onlyStatus.toLowerCase().replace(/\s+/g, '_')}`,
      counts,
    };
  }

  const onlyPlannedAndToDo = statuses.every((status) =>
    status === PARENT_STATUS_PLANNED || status === PARENT_STATUS_TO_DO,
  );

  if (onlyPlannedAndToDo && counts[PARENT_STATUS_TO_DO]) {
    return {
      desiredStatus: PARENT_STATUS_TO_DO,
      reason: 'planned_and_to_do',
      counts,
    };
  }

  return {
    desiredStatus: PARENT_STATUS_IN_PROGRESS,
    reason: 'mixed_tracked_statuses',
    counts,
  };
}

function hasClickUpDate(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

function parseClickUpTimestamp(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function isUpdatedAfter(task: ClickUpTask, updatedAfter: string | null | undefined) {
  if (!updatedAfter) return true;
  const baselineMs = Date.parse(updatedAfter);
  if (Number.isNaN(baselineMs)) return true;

  const taskUpdatedAt = parseClickUpTimestamp(task.date_updated);
  return taskUpdatedAt === null || taskUpdatedAt > baselineMs;
}

function optionScalarValues(option: any) {
  return [option?.id, option?.orderindex, option?.orderIndex, option?.index, option?.name]
    .filter((item) => item !== null && item !== undefined && item !== '')
    .map(String);
}

function customFieldValueMatches(task: ClickUpTask, fieldId: string, option: any) {
  const fields = Array.isArray(task.custom_fields) ? task.custom_fields : [];
  const field = fields.find((item) => String(item?.id) === String(fieldId));
  const value = field?.value;
  if (value === null || value === undefined || value === '') return false;

  const expectedValues = optionScalarValues(option);
  const expectedNames = option?.name ? [norm(String(option.name))] : [];

  const matchesScalar = (candidate: any) => {
    if (candidate === null || candidate === undefined || candidate === '') return false;
    const text = String(candidate);
    return expectedValues.includes(text) || expectedNames.includes(norm(text));
  };

  const matches = (candidate: any): boolean => {
    if (matchesScalar(candidate)) return true;
    if (typeof candidate !== 'object' || candidate === null) return false;

    const nestedCandidates = [
      candidate.id,
      candidate.value,
      candidate.option_id,
      candidate.optionId,
      candidate.orderindex,
      candidate.orderIndex,
      candidate.index,
      candidate.name,
      candidate.label,
    ];

    return nestedCandidates.some((item) => {
      if (matchesScalar(item)) return true;
      return typeof item === 'object' && item !== null ? matches(item) : false;
    });
  };

  if (Array.isArray(value)) return value.some(matches);
  return matches(value);
}

function createTotals(): Required<SyncTotals> {
  return { updated: 0, skipped: 0, ignored: 0, errors: 0, details: [] };
}

function addTotals(target: Required<SyncTotals>, source: SyncTotals, includeDetails = true) {
  target.updated += source.updated || 0;
  target.skipped += source.skipped || 0;
  target.ignored += source.ignored || 0;
  target.errors += source.errors || 0;
  if (includeDetails && Array.isArray(source.details)) target.details.push(...source.details);
}

async function fetchListPage(listId: string, page: number): Promise<ClickUpTask[]> {
  const data = await req(
    `/list/${listId}/task?include_timl=true&include_closed=true&archived=false&subtasks=false&page=${page}`,
  );
  return data?.tasks || [];
}

async function getRootTasksFromList(listId: string, updatedAfter?: string | null) {
  const rootTasks: ClickUpTask[] = [];
  let totalApiItems = 0;
  let totalRootTasks = 0;
  let page = 0;

  while (true) {
    const tasks = await fetchListPage(listId, page);
    totalApiItems += tasks.length;

    const rootsOnPage = tasks.filter((task) => !task.parent);
    totalRootTasks += rootsOnPage.length;
    rootTasks.push(...rootsOnPage.filter((task) => isUpdatedAfter(task, updatedAfter)));

    if (tasks.length < PAGE_SIZE) break;
    page += 1;
  }

  return {
    rootTasks,
    discovery: {
      listId,
      pagesFetched: page + 1,
      totalApiItems,
      totalRootTasks,
      candidateRootTasks: rootTasks.length,
      updatedAfter: updatedAfter || null,
    },
  };
}

async function getFieldsForList(listId: string, cache?: FieldCache) {
  if (cache?.has(listId)) return cache.get(listId) || [];
  const data = await req(`/list/${listId}/field`);
  const fields = data?.fields || [];
  cache?.set(listId, fields);
  return fields;
}

async function getTeamId() {
  if (process.env.CLICKUP_TEAM_ID) return process.env.CLICKUP_TEAM_ID;

  const data = await req('/team');
  const team = data?.teams?.[0];
  if (!team?.id) throw new Error('No ClickUp workspaces available for CLICKUP_TOKEN');
  return String(team.id);
}

export async function getTask(id: string) {
  return req(`/task/${id}?include_subtasks=true`);
}

async function updateTaskStatus(taskId: string, status: string) {
  return req(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export async function syncParentStatusFromSubtasks(parentId: string) {
  const parent: ClickUpTask & { subtasks?: ClickUpTask[] } = await getTask(parentId);

  if (parent.parent) {
    return {
      updated: 0,
      skipped: 0,
      ignored: 1,
      errors: 0,
      parentId: String(parentId),
      parentName: parent.name,
      reason: 'parent_is_not_root_task',
    };
  }

  const firstLevelSubtasks = (parent.subtasks || []).filter((subtask) => String(subtask.parent || '') === String(parentId));
  const decision = getParentStatusDecision(firstLevelSubtasks);

  if (!decision.desiredStatus) {
    return {
      updated: 0,
      skipped: 0,
      ignored: 1,
      errors: 0,
      parentId: String(parentId),
      parentName: parent.name,
      currentStatus: parent.status?.status || '',
      desiredStatus: null,
      reason: decision.reason,
      subtaskStatusCounts: decision.counts,
    };
  }

  const currentStatus = parent.status?.status || '';
  if (normStatus(currentStatus) === decision.desiredStatus) {
    return {
      updated: 0,
      skipped: 1,
      ignored: 0,
      errors: 0,
      parentId: String(parentId),
      parentName: parent.name,
      currentStatus,
      desiredStatus: decision.desiredStatus,
      reason: 'parent_status_already_set',
      subtaskStatusCounts: decision.counts,
    };
  }

  try {
    await updateTaskStatus(parentId, decision.desiredStatus);
    return {
      updated: 1,
      skipped: 0,
      ignored: 0,
      errors: 0,
      parentId: String(parentId),
      parentName: parent.name,
      previousStatus: currentStatus,
      desiredStatus: decision.desiredStatus,
      reason: decision.reason,
      subtaskStatusCounts: decision.counts,
    };
  } catch (error: any) {
    return {
      updated: 0,
      skipped: 0,
      ignored: 0,
      errors: 1,
      parentId: String(parentId),
      parentName: parent.name,
      currentStatus,
      desiredStatus: decision.desiredStatus,
      reason: 'parent_status_update_failed',
      error: error?.message || String(error),
      subtaskStatusCounts: decision.counts,
    };
  }
}

export async function syncTaskStatusFromDates(task: ClickUpTask) {
  const taskId = String(task.id);
  const currentStatus = task.status?.status || '';
  const normalizedStatus = normStatus(currentStatus);
  const hasStartDate = hasClickUpDate(task.start_date);
  const hasDueDate = hasClickUpDate(task.due_date);
  const desiredStatus = hasStartDate && hasDueDate ? PARENT_STATUS_TO_DO : PARENT_STATUS_PLANNED;

  if (!task.parent) {
    return {
      updated: 0,
      skipped: 0,
      ignored: 1,
      errors: 0,
      taskId,
      from: currentStatus,
      to: null,
      hasStartDate,
      hasDueDate,
      reason: 'task_is_not_subtask',
    };
  }

  if (DATE_STATUS_IGNORED_STATUSES.has(normalizedStatus)) {
    return {
      updated: 0,
      skipped: 0,
      ignored: 1,
      errors: 0,
      taskId,
      from: currentStatus,
      to: null,
      hasStartDate,
      hasDueDate,
      reason: 'status_ignored',
    };
  }

  if (normalizedStatus !== PARENT_STATUS_PLANNED && normalizedStatus !== PARENT_STATUS_TO_DO) {
    return {
      updated: 0,
      skipped: 0,
      ignored: 1,
      errors: 0,
      taskId,
      from: currentStatus,
      to: null,
      hasStartDate,
      hasDueDate,
      reason: 'unknown_status_ignored',
    };
  }

  if (normalizedStatus === desiredStatus) {
    return {
      updated: 0,
      skipped: 1,
      ignored: 0,
      errors: 0,
      taskId,
      from: currentStatus,
      to: desiredStatus,
      hasStartDate,
      hasDueDate,
      reason: 'status_already_matches_dates',
    };
  }

  try {
    await updateTaskStatus(taskId, desiredStatus);
    return {
      updated: 1,
      skipped: 0,
      ignored: 0,
      errors: 0,
      taskId,
      from: currentStatus,
      to: desiredStatus,
      hasStartDate,
      hasDueDate,
      reason: hasStartDate && hasDueDate ? 'both_dates_present' : 'missing_required_dates',
    };
  } catch (error: any) {
    return {
      updated: 0,
      skipped: 0,
      ignored: 0,
      errors: 1,
      taskId,
      from: currentStatus,
      to: desiredStatus,
      hasStartDate,
      hasDueDate,
      reason: 'date_status_update_failed',
      error: error?.message || String(error),
    };
  }
}

export async function discoverUpdatedRootTasks(listIds: string[], updatedAfter?: string | null) {
  const taskIds: string[] = [];
  const discovery: any[] = [];

  for (const listId of listIds) {
    const result = await getRootTasksFromList(listId, updatedAfter);
    discovery.push(result.discovery);
    taskIds.push(...result.rootTasks.map((task) => task.id));
  }

  return { taskIds, discovery };
}

export async function syncParentTask(id: string, fieldCache?: FieldCache): Promise<SyncTotals> {
  const parent: ClickUpTask & { subtasks?: ClickUpTask[] } = await getTask(id);
  const listId = parent.list?.id;
  if (!listId) return { updated: 0, skipped: 0, ignored: 1, errors: 0, details: [] };

  const fields = await getFieldsForList(listId, fieldCache);
  const subtasks = parent.subtasks || [];
  let updated = 0;
  let skipped = 0;
  let ignored = 0;
  let errors = 0;
  const details: any[] = [];

  for (const sub of subtasks) {
    const f = fields.find((x: any) => norm(x.name) === norm(sub.name));
    if (!f) {
      ignored += 1;
      details.push({ subtaskId: sub.id, subtask: sub.name, reason: 'no_matching_custom_field' });
      continue;
    }

    const status = sub.status?.status || '';
    const opts = f.type_config?.options || [];
    const opt = opts.find((o: any) => norm(o.name) === norm(status));
    if (!opt) {
      skipped += 1;
      details.push({
        subtaskId: sub.id,
        subtask: sub.name,
        status,
        field: f.name,
        reason: 'no_matching_dropdown_option',
      });
      continue;
    }

    if (customFieldValueMatches(parent, f.id, opt)) {
      skipped += 1;
      details.push({
        subtaskId: sub.id,
        subtask: sub.name,
        status,
        field: f.name,
        option: opt.name,
        reason: 'field_already_set',
      });
      continue;
    }

    try {
      await req(`/task/${id}/field/${f.id}`, {
        method: 'POST',
        body: JSON.stringify({ value: opt.id }),
      });
      updated += 1;
      details.push({
        subtaskId: sub.id,
        subtask: sub.name,
        status,
        field: f.name,
        option: opt.name,
        action: 'updated_parent_field',
      });
    } catch (e: any) {
      errors += 1;
      details.push({
        subtaskId: sub.id,
        subtask: sub.name,
        status,
        field: f.name,
        option: opt.name,
        action: 'error',
        error: e.message,
      });
    }
  }

  return { updated, skipped, ignored, errors, details };
}

export async function syncParentTasks(
  taskIds: string[],
  options: {
    fieldCache?: FieldCache;
    concurrency?: number;
    includeDetails?: boolean;
    onProgress?: (processed: number, total: number) => void;
  } = {},
) {
  const totals = createTotals();
  const fieldCache = options.fieldCache || new Map<string, any[]>();
  const concurrency = Math.max(1, Math.min(options.concurrency || 4, taskIds.length || 1));
  const includeDetails = options.includeDetails !== false;
  let nextIndex = 0;
  let processed = 0;

  async function worker() {
    while (nextIndex < taskIds.length) {
      const taskId = taskIds[nextIndex++];
      try {
        const result = await syncParentTask(taskId, fieldCache);
        addTotals(totals, result, includeDetails);
      } catch (e: any) {
        totals.errors += 1;
        if (includeDetails) {
          totals.details.push({ parentId: taskId, action: 'error', reason: 'sync_parent_failed', error: e.message });
        }
      } finally {
        processed += 1;
        options.onProgress?.(processed, taskIds.length);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return totals;
}

export async function syncLists(listIds: string[]) {
  const fieldCache: FieldCache = new Map();
  const startedAt = new Date().toISOString();
  console.log('[syncLists] start', { listIds, startedAt });

  const { taskIds, discovery } = await discoverUpdatedRootTasks(listIds, null);
  console.log('[syncLists] discovery complete', {
    listCount: listIds.length,
    totalRootTasks: taskIds.length,
    discovery,
    elapsedMs: Date.now() - Date.parse(startedAt),
  });

  const result = await syncParentTasks(taskIds, {
    fieldCache,
    concurrency: 4,
    onProgress(processed, total) {
      if (processed % 25 === 0 || processed === total) {
        console.log('[syncLists] progress', { processed, total, elapsedMs: Date.now() - Date.parse(startedAt) });
      }
    },
  });

  console.log('[syncLists] complete', {
    totalParentTasks: taskIds.length,
    updated: result.updated,
    skipped: result.skipped,
    ignored: result.ignored,
    errors: result.errors,
    elapsedMs: Date.now() - Date.parse(startedAt),
  });

  return { ...result, discovery };
}

export function verifyWebhook(raw: string, secretOrSignature?: string | null, signatureMaybe?: string | null) {
  const secret = signatureMaybe === undefined ? process.env.CLICKUP_WEBHOOK_SECRET : secretOrSignature;
  const signature = signatureMaybe === undefined ? secretOrSignature : signatureMaybe;
  if (!secret) return true;
  if (!signature) return false;

  const h = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const expected = Buffer.from(h);
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export async function getLists() {
  const teamId = await getTeamId();
  const spaces = await req(`/team/${teamId}/space?archived=false`);
  const out: any[] = [];

  for (const sp of spaces.spaces || []) {
    const folders = await req(`/space/${sp.id}/folder?archived=false`);

    for (const fo of folders.folders || []) {
      const lists = await req(`/folder/${fo.id}/list?archived=false`);
      for (const li of lists.lists || []) {
        out.push({
          id: String(li.id),
          name: li.name,
          spaceId: String(sp.id),
          spaceName: sp.name,
          folderId: String(fo.id),
          folderName: fo.name,
        });
      }
    }

    const folderless = await req(`/space/${sp.id}/list?archived=false`);
    for (const li of folderless.lists || []) {
      out.push({
        id: String(li.id),
        name: li.name,
        spaceId: String(sp.id),
        spaceName: sp.name,
        folderId: null,
        folderName: null,
      });
    }
  }

  return out;
}
