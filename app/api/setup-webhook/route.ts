import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '../../../lib/store';

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

// fixed: no export here
async function setupWebhooks(origin: string) {
  const teams = await clickupReq('/team');
  const teamId = teams?.teams?.[0]?.id;

  if (!teamId) {
    throw new Error('no_team_id');
  }

  const config = await getConfig();
  const selectedListIds = config?.selectedListIds || [];

  if (!selectedListIds.length) {
    throw new Error('no_selected_list');
  }

  const endpoint = `${origin}/api/clickup-webhook`;

  const existing = await clickupReq(`/team/${teamId}/webhook`);
  const webhooks = existing?.webhooks || [];

  for (const wh of webhooks) {
    if (wh.endpoint === endpoint) {
      await clickupReq(`/webhook/${wh.id}`, { method: 'DELETE' });
    }
  }

  for (const listId of selectedListIds) {
    await clickupReq(`/team/${teamId}/webhook`, {
      method: 'POST',
      body: JSON.stringify({
        endpoint,
        events: ['taskStatusUpdated'],
        list_id: listId,
      }),
    });
  }
}

export async function GET(req: NextRequest) {
  try {
    await setupWebhooks(req.nextUrl.origin);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
