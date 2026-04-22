import { NextRequest, NextResponse } from 'next/server';
import { appendRun, getConfig } from '../../../lib/store';
import { syncLists } from '../../../lib/clickup';

export async function POST(req: NextRequest) {
  const cookieAuth = req.cookies.get('ca_auth')?.value === '1';

  let token: string | null = null;

  try {
    const json = await req.json();
    token = json?.token || null;
  } catch {
    const form = await req.formData();
    token = String(form.get('token') || '');
  }

  const isAuthorized = cookieAuth || token === process.env.ADMIN_TOKEN;

  if (!isAuthorized) {
    return NextResponse.redirect(new URL('/?error=unauthorized', req.url), { status: 303 });
  }

  try {
    const config = await getConfig();
    const listIds = config?.selectedListIds?.length
      ? config.selectedListIds
      : process.env.CLICKUP_LIST_ID
      ? [process.env.CLICKUP_LIST_ID]
      : [];

    if (!listIds.length) {
      return NextResponse.redirect(new URL('/?error=no_list_configured', req.url), { status: 303 });
    }

    const result = await syncLists(listIds);

    await appendRun({
      type: 'manual',
      ok: true,
      result,
      date: new Date().toISOString()
    });

    return NextResponse.redirect(new URL('/', req.url), { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync_failed';

    await appendRun({
      type: 'manual',
      ok: false,
      error: message,
      date: new Date().toISOString()
    });

    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(message)}`, req.url), { status: 303 });
  }
}
