import { NextRequest, NextResponse } from 'next/server';

const API = 'https://api.clickup.com/api/v2';

async function req(path: string, init?: RequestInit) {
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
    const teams = await req('/team');
    const teamId = teams?.teams?.[0]?.id;

    if (!teamId) {
      return NextResponse.json({ ok: false, error: 'no_team_id' });
    }

    const endpoint = `${req.nextUrl.origin}/api/clickup-webhook`;

    const webhook = await req(`/team/${teamId}/webhook`, {
      method: 'POST',
      body: JSON.stringify({
        endpoint,
        events: ['taskStatusUpdated'],
        list_id: process.env.CLICKUP_LIST_ID,
      }),
    });

    return NextResponse.json({ ok: true, webhook });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
