import { createHmac, timingSafeEqual } from 'crypto';

const API = 'https://api.clickup.com/api/v2';
const PAGE_SIZE = 100;

const token = () => {
  if (!process.env.CLICKUP_TOKEN) throw new Error('no token');
  return process.env.CLICKUP_TOKEN;
};

const req = async (p: string, i?: RequestInit) => {
  const r = await fetch(API + p, {
    ...i,
    headers: {
      Authorization: token(),
      'Content-Type': 'application/json',
      ...(i?.headers || {}),
    },
  });

  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

const norm = (v: string) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

type ClickUpTask = {
  id: string;
  name?: string;
  parent?: string | null;
  status?: { status?: string };
  list?: { id?: string };
  subtasks?: ClickUpTask[];
};

async function fetchListPage(listId: string, page: number) {
  const data = await req(
    `/list/${listId}/task?include_timl=true&include_closed=true&archived=false&subtasks=false&page=${page}`
  );

  return (data.tasks || []) as ClickUpTask[];
}

async function getRootTasksFromList(listId: string) {
  const rootTaskMap = new Map<string, ClickUpTask>();
  const pages: Array<{
    page: number;
    apiItems: number;
    rootItemsOnPage: number;
    accumulatedRootItems: number;
    sampleTaskNames: string[];
  }> = [];

  let totalApiItems = 0;
  let page = 0;

  while (true) {
    const pageTasks = await fetchListPage(listId, page);
    if (!pageTasks.length) break;

    const rootTasksOnPage = pageTasks.filter((task) => !task.parent);
    totalApiItems += pageTasks.length;

    for (const task of rootTasksOnPage) {
      rootTaskMap.set(String(task.id), task);
    }

    pages.push({
      page,
      apiItems: pageTasks.length,
      rootItemsOnPage: rootTasksOnPage.length,
      accumulatedRootItems: rootTaskMap.size,
      sampleTaskNames: rootTasksOnPage.slice(0, 10).map((task) => task.name || ''),
    });

    if (pageTasks.length < PAGE_SIZE) break;
    page += 1;
  }

  const rootTasks = [...rootTaskMap.values()].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'en', { numeric: true })
  );

  return {
    rootTasks,
    discovery: {
      listId: String(listId),
      pagesFetched: pages.length,
      totalApiItems,
      totalRootTasks: rootTasks.length,
      pages,
      rootTasks: rootTasks.map((task) => ({
        id: String(task.id || ''),
        name: task.name || '',
      })),
    },
  };
}

export const getTask = (id: string) => req(`/task/${id}?include_subtasks=true`);

export async function syncParentTask(id: string) {
  const t = (await getTask(id)) as ClickUpTask;
  const list = t.list?.id;

  if (!list) {
    return {
      updated: 0,
      skipped: 0,
      ignored: 0,
      errors: 0,
      details: [{ parentId: id, parentName: t.name || '', action: 'ignored', reason: 'parent_has_no_list' }],
    };
  }

  const fields = ((await req(`/list/${list}/field`)).fields || []) as any[];
  const subtasks = (t.subtasks || []).filter((sub) => String(sub.parent || '') === String(id));

  let u = 0;
  let s = 0;
  let i = 0;
  let e = 0;
  const details: any[] = [];

  for (const sub of subtasks) {
    const base = {
      parentId: String(id),
      parentName: t.name || '',
      subtaskId: String(sub.id || ''),
      subtaskName: sub.name || '',
      subtaskStatus: sub.status?.status || '',
      listId: String(list),
    };

    const f = fields.find((x: any) => norm(x.name) === norm(sub.name || ''));
    if (!f) {
      s++;
      details.push({ ...base, action: 'skipped', reason: 'field_not_found' });
      continue;
    }

    const options = f.type_config?.options || [];
    const opt = options.find((o: any) => norm(o.name) === norm(sub.status?.status || ''));
    if (!opt) {
      s++;
      details.push({
        ...base,
        action: 'skipped',
        reason: 'status_option_not_found',
        fieldId: String(f.id || ''),
        fieldName: f.name || '',
        availableOptions: options.map((o: any) => o.name),
      });
      continue;
    }

    try {
      await req(`/task/${id}/field/${f.id}`, {
        method: 'POST',
        body: JSON.stringify({ value: opt.id }),
      });
      u++;
      details.push({
        ...base,
        action: 'updated',
        fieldId: String(f.id || ''),
        fieldName: f.name || '',
        matchedOptionId: String(opt.id || ''),
        matchedOptionName: opt.name || '',
      });
    } catch (err: any) {
      e++;
      details.push({
        ...base,
        action: 'error',
        reason: 'field_update_failed',
        fieldId: String(f.id || ''),
        fieldName: f.name || '',
        matchedOptionId: String(opt.id || ''),
        matchedOptionName: opt.name || '',
        error: err instanceof Error ? err.message : String(err || 'unknown_error'),
      });
    }
  }

  if (!details.length) {
    i++;
    details.push({
      parentId: String(id),
      parentName: t.name || '',
      action: 'ignored',
      reason: 'no_first_level_subtasks_found',
      listId: String(list),
    });
  }

  return { updated: u, skipped: s, ignored: i, errors: e, details };
}

export async function syncLists(ids: string[]) {
  let u = 0;
  let s = 0;
  let i = 0;
  let e = 0;
  const details: any[] = [];
  const discovery: any[] = [];

  for (const id of ids) {
    const { rootTasks, discovery: listDiscovery } = await getRootTasksFromList(id);
    discovery.push(listDiscovery);

    if (!rootTasks.length) {
      details.push({ listId: String(id), action: 'ignored', reason: 'no_root_tasks_detected' });
      continue;
    }

    for (const rootTask of rootTasks) {
      const r = await syncParentTask(String(rootTask.id));
      u += r.updated;
      s += r.skipped;
      i += r.ignored;
      e += r.errors;
      details.push(...(r.details || []));
    }
  }

  return { updated: u, skipped: s, ignored: i, errors: e, details, discovery };
}

export function verifyWebhook(body: string, secret: string, sig: string) {
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const received = sig.startsWith('sha256=') ? sig.slice('sha256='.length) : sig;

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  } catch {
    return false;
  }
}

export async function getLists() {
  const teams = ((await req('/team')).teams || []) as any[];
  const out: any[] = [];

  for (const t of teams) {
    const spaces = ((await req(`/team/${t.id}/space`)).spaces || []) as any[];
    for (const s of spaces) {
      const spaceLists = ((await req(`/space/${s.id}/list`)).lists || []) as any[];
      for (const l of spaceLists) {
        out.push({
          id: String(l.id),
          name: l.name,
          spaceId: String(s.id),
          spaceName: s.name,
          folderId: null,
          folderName: 'No folder',
        });
      }

      const folders = ((await req(`/space/${s.id}/folder`)).folders || []) as any[];
      for (const f of folders) {
        const lists = ((await req(`/folder/${f.id}/list`)).lists || []) as any[];
        for (const l of lists) {
          out.push({
            id: String(l.id),
            name: l.name,
            spaceId: String(s.id),
            spaceName: s.name,
            folderId: String(f.id),
            folderName: f.name,
          });
        }
      }
    }
  }

  return out.sort((a, b) =>
    [a.spaceName, a.folderName, a.name]
      .join('\u0000')
      .localeCompare([b.spaceName, b.folderName, b.name].join('\u0000'), 'en', { numeric: true })
  );
}
