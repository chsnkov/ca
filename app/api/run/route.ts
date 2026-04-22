import { NextRequest, NextResponse } from 'next/server';
import { appendRun, getConfig } from '../../../lib/store';
import { syncLists } from '../../../lib/clickup';

export async function POST(req: NextRequest) {
  let token: string | null = null;

  try {
    const json = await req.json();
    token = json?.token || null;
  } catch {
    const form = await req.formData();
    token = String(form.get('token') || '');
  }

  if (token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const config = await getConfig();
    const listIds = config?.selectedListIds || [];

    if (!listIds.length) {
      return NextResponse.json({ error: 'no lists configured' }, { status: 400 });
    }

    const result = await syncLists(listIds);

    await appendRun({
      type: 'manual',
      ok: true,
      result,
      date: new Date().toISOString()
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';

    await appendRun({
      type: 'manual',
      ok: false,
      error: message,
      date: new Date().toISOString()
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
