import { NextRequest, NextResponse } from 'next/server';
import { appendRun, getConfig, getStats, saveConfig } from '../../../lib/store';
import { createManualSyncState, manualSyncStateToResult, runManualSyncChunk } from '../../../lib/clickup';
import { getSyncToggles } from '../../../lib/sync-toggles';

function normalizeDate(value: any) {
  if (!value) return null;
  const time = Date.parse(String(value));
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function latestDate(...values: Array<string | null>) {
  return values
    .filter(Boolean)
    .sort((a, b) => Date.parse(String(b)) - Date.parse(String(a)))[0] || null;
}

function getLastSuccessfulRunFromStats(stats: any) {
  const runs = Array.isArray(stats?.runs) ? stats.runs : [];
  const candidates = runs
    .filter((run: any) => (run?.type === 'scheduled' || run?.type === 'manual') && run?.ok === true)
    .map((run: any) => normalizeDate(run?.startedAt || run?.result?.startedAt || run?.date || run?.finishedAt || run?.timestamp))
    .filter(Boolean);

  return latestDate(...candidates);
}

function getManualSmartUpdatedAfter(config: any, stats: any) {
  return latestDate(
    normalizeDate(config?.lastManualSyncStartedAt),
    normalizeDate(config?.autoSync?.lastStartedAt),
    normalizeDate(config?.lastScheduledRunAt),
    getLastSuccessfulRunFromStats(stats),
    normalizeDate(config?.autoSync?.lastFinishedAt),
    normalizeDate(config?.lastScheduledRunFinishedAt),
  );
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
    const [config, stats] = await Promise.all([getConfig(), getStats()]);
    const listIds = config?.selectedListIds?.length
      ? config.selectedListIds
      : process.env.CLICKUP_LIST_ID
        ? [process.env.CLICKUP_LIST_ID]
        : [];

    if (!listIds.length) {
      return NextResponse.redirect(new URL('/?error=no_list_configured', req.url), { status: 303 });
    }

    const syncToggles = getSyncToggles(config);
    const manualUpdatedAfter = syncToggles.manual.mode === 'smart'
      ? getManualSmartUpdatedAfter(config, stats)
      : null;
    const options = {
      includeCustomFieldSync: syncToggles.manual.customFieldSync,
      includeParentStatusSync: syncToggles.manual.parentStatusSync,
      includeDateStatusSync: syncToggles.manual.dateStatusSync,
      mode: syncToggles.manual.mode,
      updatedAfter: manualUpdatedAfter,
    };
    const initialState = config?.manualSync?.status === 'running'
      ? config.manualSync
      : await createManualSyncState(listIds, options);
    const { state, result } = await runManualSyncChunk(initialState);

    const nextConfig = {
      ...config,
      manualSync: state,
      ...(state.status === 'idle'
        ? {
            lastManualSyncStartedAt: state.startedAt,
            lastManualSyncFinishedAt: state.finishedAt || new Date().toISOString(),
          }
        : {}),
    };

    await saveConfig(nextConfig);

    if (state.status === 'idle') {
      await appendRun({
        type: 'manual',
        ok: true,
        action: 'completed_chunks',
        result,
        options: state.options,
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
