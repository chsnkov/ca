import { getConfig, saveConfig } from './store';

const API = 'https://api.clickup.com/api/v2';

async function clickupReq(path: string, init?: RequestInit) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: process.env.CLICKUP_TOKEN || '',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}

async function getListName(listId: string) {
  try {
    const list = await clickupReq(`/list/${listId}`);
    return list?.name ? String(list.name) : null;
  } catch {
    return null;
  }
}

export async function setupWebhooks(origin: string, listIds?: string[], configPatch: Record<string, unknown> = {}) {
  const teams = await clickupReq('/team');
  const teamId = teams?.teams?.[0]?.id;

  if (!teamId) {
    throw new Error('no_team_id');
  }

  const config = await getConfig();
  const rawListIds = (listIds?.length ? listIds : config?.selectedListIds || []) as unknown[];
  const selectedListIds = [...new Set(rawListIds.map(String).filter(Boolean))];

  if (!selectedListIds.length) {
    throw new Error('no_selected_list');
  }

  const endpoint = `${origin}/api/clickup-webhook`;

  const existing = await clickupReq(`/team/${teamId}/webhook`);
  const webhooks = existing?.webhooks || [];
  const deletedWebhooks: string[] = [];
  const createdWebhooks: Array<{ id?: string; listId: string; listName: string | null; endpoint: string }> = [];

  for (const wh of webhooks) {
    if (wh.endpoint === endpoint) {
      await clickupReq(`/webhook/${wh.id}`, { method: 'DELETE' });
      deletedWebhooks.push(String(wh.id));
    }
  }

  for (const listId of selectedListIds) {
    const listName = await getListName(listId);
    const payload: Record<string, unknown> = {
      endpoint,
      events: ['taskStatusUpdated'],
      list_id: listId,
    };

    if (process.env.CLICKUP_WEBHOOK_SECRET) {
      payload.secret = process.env.CLICKUP_WEBHOOK_SECRET;
    }

    const created = await clickupReq(`/team/${teamId}/webhook`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    createdWebhooks.push({
      id: created?.webhook?.id || created?.id,
      listId: String(listId),
      listName,
      endpoint,
    });
  }

  await saveConfig({
    ...config,
    ...configPatch,
    selectedListIds,
    managedWebhooks: createdWebhooks,
  });

  return {
    teamId: String(teamId),
    endpoint,
    selectedListIds,
    deletedWebhooks,
    createdWebhooks,
  };
}
