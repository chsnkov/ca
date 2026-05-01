import { NextRequest, NextResponse } from 'next/server';
import { appendRun, getConfig, saveConfig } from '../../../lib/store';
import { createManualSyncState, manualSyncStateToResult, runManualSyncChunk } from '../../../lib/clickup';
import { getSyncToggles } from '../../../lib/sync-toggles';

export async function POST(req: NextRequest) {
  const cookieAuth = req.cookies.get('ca_auth')?.value === '1';
  const contentType = req.headers.get('content-type') || '';

  let token: string | null = null;

  if (contentType.includes('application/json')) {
    try {
      const json = await req.json();
      token = json?.token || null;
    } catch {
      token = null;
    }
  } else {
    try {
      const form = await req.formData();
      token = String(form.get('token') || '');
    } catch {
      token = null;
    }
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

    const syncToggles = getSyncToggles(config);
    const options = {
      includeCustomFieldSync: syncToggles.auto.customFieldSync,
      includeParentStatusSync: syncToggles.auto.parentStatusSync,
      includeDateStatusSync: syncToggles.auto.dateStatusSync,
    };
    const initialState = config?.manualSync?.status === 'running'
      ? config.manualSync
      : await createManualSyncState(listIds, options);
    const { state, result } = await runManualSyncChunk(initialState);

    await saveConfig({
      ...config,
      manualSync: state,
    });

    if (state.status === 'idle') {
      await appendRun({
        type: 'manual',
        ok: true,
        action: 'completed_chunks',
        result,
        date: new Date().toISOString(),
      });
    }

    return NextResponse.redirect(new URL('/', req.url), { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync_failed';

    try {
      await appendRun({
        type: 'manual',
        ok: false,
        error: message,
        date: new Date().toISOString(),
      });
    } catch {}

    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(message)}`, req.url), { status: 303 });
  }
}
