import { after, NextRequest, NextResponse } from 'next/server';
import { appendRun, getConfig, saveConfig } from '../../../lib/store';
import { createManualSyncState, manualSyncStateToResult, runManualSyncChunk } from '../../../lib/clickup';

async function runManualSyncToCompletion(initialState: any) {
  let state = initialState;

  try {
    while (state.status === 'running') {
      const chunk = await runManualSyncChunk(state);
      state = chunk.state;
      const latestConfig = await getConfig();
      await saveConfig({
        ...latestConfig,
        manualSync: state,
      });
    }

    await appendRun({
      type: 'manual',
      ok: true,
      action: 'completed_background',
      result: manualSyncStateToResult(state),
      date: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync_failed';
    const latestConfig = await getConfig();
    await saveConfig({
      ...latestConfig,
      manualSync: {
        ...state,
        status: 'failed',
        failedAt: new Date().toISOString(),
        error: message,
      },
    });

    await appendRun({
      type: 'manual',
      ok: false,
      action: 'failed_background',
      error: message,
      result: state ? manualSyncStateToResult(state) : null,
      date: new Date().toISOString(),
    });
  }
}

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

    if (config?.manualSync?.status === 'running') {
      return NextResponse.redirect(new URL('/', req.url), { status: 303 });
    }

    const options = {
      includeCustomFieldSync: config?.autoSyncEnabled !== false,
      includeParentStatusSync: config?.parentStatusSyncEnabled !== false,
      includeDateStatusSync: config?.dateStatusSyncEnabled !== false,
    };
    const state = await createManualSyncState(listIds, options);

    await saveConfig({
      ...config,
      manualSync: state,
    });

    after(() => runManualSyncToCompletion(state));

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
