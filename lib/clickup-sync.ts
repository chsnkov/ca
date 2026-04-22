type ClickUpStatus = {
  status?: string;
};

export type ClickUpCustomField = {
  id: string;
  name?: string;
  value?: string | number | boolean | null;
};

export type ClickUpTask = {
  id: string;
  name: string;
  parent?: string | null;
  status?: ClickUpStatus;
  custom_fields?: ClickUpCustomField[];
  subtasks?: ClickUpTask[];
};

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';
const CLICKUP_PAGE_SIZE = 100;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getClickUpToken(): string {
  return getRequiredEnv('CLICKUP_TOKEN');
}

function getListIds(): string[] {
  return getRequiredEnv('CLICKUP_LIST_IDS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function getSubtaskFieldMap(): Record<string, string> {
  return {
    Layout: getRequiredEnv('CF_LAYOUT_ID'),
    Animation: getRequiredEnv('CF_ANIMATION_ID'),
    'Shot Assembly': getRequiredEnv('CF_SHOT_ASSEMBLY_ID'),
    Render: getRequiredEnv('CF_RENDER_ID'),
    FX: getRequiredEnv('CF_FX_ID'),
  };
}

async function clickupFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${CLICKUP_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: getClickUpToken(),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ClickUp request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

function normalizeTaskName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getTaskStatus(task: ClickUpTask): string {
  return task.status?.status ?? '';
}

function getCurrentCustomFieldValue(task: ClickUpTask, fieldId: string): string | number | boolean | null | undefined {
  return task.custom_fields?.find((field) => field.id === fieldId)?.value;
}

function isFirstLevelSubtask(task: ClickUpTask, parentTaskId: string): boolean {
  return task.parent === parentTaskId;
}

function sortTasksByName(tasks: ClickUpTask[]): ClickUpTask[] {
  return tasks.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

export async function getRootTasksFromList(listId: string): Promise<ClickUpTask[]> {
  const rootTaskMap = new Map<string, ClickUpTask>();
  let page = 0;

  while (true) {
    const result = await clickupFetch<{ tasks?: ClickUpTask[] }>(
      `/list/${listId}/task?archived=false&include_closed=true&include_timl=true&subtasks=false&page=${page}`
    );

    const pageTasks = result.tasks ?? [];
    if (pageTasks.length === 0) {
      break;
    }

    for (const task of pageTasks) {
      if (task.parent) {
        continue;
      }

      rootTaskMap.set(task.id, task);
    }

    console.log(`[ClickUp sync] List ${listId}: fetched page ${page}, received ${pageTasks.length} tasks, accumulated ${rootTaskMap.size} root tasks`);

    if (pageTasks.length < CLICKUP_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return sortTasksByName(Array.from(rootTaskMap.values()));
}

export async function getTaskWithSubtasks(taskId: string): Promise<ClickUpTask> {
  return clickupFetch<ClickUpTask>(`/task/${taskId}?include_subtasks=true`);
}

export async function setTaskCustomField(taskId: string, fieldId: string, value: string): Promise<void> {
  await clickupFetch(`/task/${taskId}/field/${fieldId}`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  });
}

function buildDesiredFieldMap(parentTask: ClickUpTask): Record<string, string> {
  const subtaskFieldMap = getSubtaskFieldMap();
  const desiredFieldMap: Record<string, string> = {};

  for (const subtask of parentTask.subtasks ?? []) {
    if (!isFirstLevelSubtask(subtask, parentTask.id)) {
      continue;
    }

    const normalizedSubtaskName = normalizeTaskName(subtask.name);
    const match = Object.entries(subtaskFieldMap).find(([subtaskName]) => {
      return normalizeTaskName(subtaskName) === normalizedSubtaskName;
    });

    if (!match) {
      continue;
    }

    const [, fieldId] = match;
    desiredFieldMap[fieldId] = getTaskStatus(subtask);
  }

  return desiredFieldMap;
}

export async function syncParentTask(parentTaskId: string): Promise<void> {
  const parentTask = await getTaskWithSubtasks(parentTaskId);
  const desiredFieldMap = buildDesiredFieldMap(parentTask);

  for (const [fieldId, desiredValue] of Object.entries(desiredFieldMap)) {
    const currentValue = getCurrentCustomFieldValue(parentTask, fieldId);

    if (currentValue === desiredValue) {
      continue;
    }

    await setTaskCustomField(parentTask.id, fieldId, desiredValue);
    console.log(
      `[ClickUp sync] ${parentTask.name}: field ${fieldId} updated from ${JSON.stringify(currentValue)} to ${JSON.stringify(desiredValue)}`
    );
  }
}

export async function syncLists(): Promise<void> {
  const listIds = getListIds();

  for (const listId of listIds) {
    console.log(`[ClickUp sync] Starting list sync for ${listId}`);
    const rootTasks = await getRootTasksFromList(listId);
    console.log(`[ClickUp sync] Found ${rootTasks.length} root tasks in list ${listId}`);

    for (const rootTask of rootTasks) {
      try {
        await syncParentTask(rootTask.id);
      } catch (error) {
        console.error(`[ClickUp sync] Failed to sync task ${rootTask.id} (${rootTask.name})`, error);
      }
    }

    console.log(`[ClickUp sync] Finished list sync for ${listId}`);
  }
}

export async function handleTaskChanged(taskId: string): Promise<void> {
  const task = await getTaskWithSubtasks(taskId);

  if (!task.parent) {
    await syncParentTask(task.id);
    return;
  }

  await syncParentTask(task.parent);
}
