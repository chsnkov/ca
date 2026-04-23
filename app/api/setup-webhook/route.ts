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

export async function GET(req: NextRequest) {
  try {
    const teams = await clickupReq('/team');
    const teamId = teams?.teams?.[0]?.id;

    if (!teamId) {
      return NextResponse.json({ ok: false, error: 'no_team_id' });
    }

    const config = await getConfig();
    const selectedListIds = config?.selectedListIds || [];

    if (!selectedListIds.length) {
      return NextResponse.json({ ok: false, error: 'no_selected_list' });
    }

    const endpoint = `${req.nextUrl.origin}/api/clickup-webhook`;

    const existing = await clickupReq(`/team/${teamId}/webhook`);
    const webhooks = existing?.webhooks || [];

    const deleted: string[] = [];

    for (const wh of webhooks) {
      if (wh.endpoint === endpoint) {
        await clickupReq(`/webhook/${wh.id}`, { method: 'DELETE' });
        deleted.push(wh.id);
      }
    }

    const created: any[] = [];

    for (const listId of selectedListIds) {
      const webhook = await clickupReq(`/team/${teamId}/webhook`, {
        method: 'POST',
        body: JSON.stringify({
          endpoint,
          events: ['taskStatusUpdated'],
          list_id: listId,
        }),
      });

      created.push({ listId, webhookId: webhook.id });
    }

    return NextResponse.json({
      ok: true,
      selectedListIds,
      deletedWebhooks: deleted,
      createdWebhooks: created,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
