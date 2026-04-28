import { discoverUpdatedRootTasks, syncParentTasks } from './clickup';
import type { SyncTotals } from './clickup';
import { appendRun, getConfig, getStats, saveConfig } from './store';

const DEFAULT_AUTO_SYNC_INTERVAL_MINUTES = 120;
const MIN_AUTO_SYNC_INTERVAL_MINUTES = 5;
const MAX_AUTO_SYNC_INTERVAL_MINUTES = 24 * 60;
const AUTO_SYNC_INTERVAL_STEP_MINUTES = 5;
const AUTO_SYNC_BATCH_SIZE = 20;
const AUTO_SYNC_TIME_BUDGET_MS = 240_000;
const AUTO_SYNC_LEASE_MS = 270_000;
const AUTO_SYNC_CONCURRENCY = 4;

type AutoSyncState = {
  status: 'running' | 'idle' | 'failed';
  startedAt?: string;
  baselineUpdatedAfter?: string | null;
  selectedListIds?: string[];
  candidateTaskIds?: string[];
  cursorIndex?: number;
  batchSize?: number;
  totals?: Omit<SyncTotals, 'details'> & { processed: number };
  discovery?: any[];
  leaseUntil?: string | null;
  lastFinishedAt?: string;
  failedAt?: string;
  error?: string;
};

function normalizeAutoSyncIntervalMinutes(value: any) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AUTO_SYNC_INTERVAL_MINUTES;
  const rounded = Math.round(parsed / AUTO_SYNC_INTERVAL_STEP_MINUTES) * AUTO_SYNC_INTERVAL_STEP_MINUTES;
  return Math.min(MAX_AUTO_SYNC_INTERVAL_MINUTES, Math.max(MIN_AUTO_SYNC_INTERVAL_MINUTES, rounded));
}

export function normalizeSyncIntervalMinutes(value: any) {
  return normalizeAutoSyncIntervalMinutes(value);
}

function getAutoSyncIntervalMinutes(config: any) {
  return normalizeAutoSyncIntervalMinutes(config?.autoSyncIntervalMinutes ?? config?.syncIntervalMinutes);
}

function getLastScheduledRunAt(stats: any) {
  const runs = Array.isArray(stats?.runs) ? stats.runs : [];
  const lastRun = runs.find((run: any) => run?.type === 'scheduled' && run?.ok === true);
  const value = lastRun?.startedAt || lastRun?.date || lastRun?.finishedAt || lastRun?.timestamp;
  if (!value) return null;

  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function getNextScheduledRunAt(lastRunAt: string | null, intervalMinutes: number) {
  if (!lastRunAt) return null;
  return new Date(Date.parse(lastRunAt) + intervalMinutes * 60_000).toISOString();
}

export function getScheduleSummary(config: any, stats: any, now = new Date()) {
  const intervalMinutes = getAutoSyncIntervalMinutes(config);
  const lastScheduledRunAt = getLastScheduledRunAt(stats);
  const nextScheduledRunAt = getNextScheduledRunAt(lastScheduledRunAt, intervalMinutes);
  const due = !nextScheduledRunAt || Date.parse(nextScheduledRunAt) <= now.getTime();

  return {
    intervalMinutes,
    lastScheduledRunAt,
    nextScheduledRunAt,
    due,
  };
}

function emptyTotals() {
  return { updated: 0, skipped: 0, ignored: 0, errors: 0, processed: 0 };
}

function mergeTotals(target: ReturnType<typeof emptyTotals>, source: SyncTotals, processed: number) {
  target.updated += source.updated || 0;
  target.skipped += source.skipped || 0;
  target.ignored += source.ignored || 0;
  target.errors += source.errors || 0;
  target.processed += processed;
}

function getRunningAutoSync(config: any): AutoSyncState | null {
  const autoSync = config?.autoSync;
  return autoSync?.status === 'running' ? autoSync : null;
}

function isLeaseActive(leaseUntil?: string | null) {
  if (!leaseUntil) return false;
  const time = Date.parse(leaseUntil);
  return !Number.isNaN(time) && time > Date.now();
}

function withLease(state: AutoSyncState): AutoSyncState {
  return {
    ...state,
    status: 'running',
    leaseUntil: new Date(Date.now() + AUTO_SYNC_LEASE_MS).toISOString(),
  };
}

function compactProgress(state: AutoSyncState) {
  const totalCandidates = state.candidateTaskIds?.length || 0;
  return {
    startedAt: state.startedAt || null,
    baselineUpdatedAfter: state.baselineUpdatedAfter || null,
    cursorIndex: state.cursorIndex || 0,
    totalCandidates,
    remaining: Math.max(0, totalCandidates - (state.cursorIndex || 0)),
    totals: state.totals || emptyTotals(),
  };
}

function compactDiscovery(discovery: any[] | undefined) {
  return (discovery || []).map((item) => ({
    listId: item.listId,
    pagesFetched: item.pagesFetched,
    totalApiItems: item.totalApiItems,
    totalRootTasks: item.totalRootTasks,
    candidateRootTasks: item.candidateRootTasks,
    updatedAfter: item.updatedAfter || null,
  }));
}

async function saveAutoSyncState(state: AutoSyncState) {
  const latestConfig = await getConfig();
  await saveConfig({ ...latestConfig, autoSync: state });
}

function errorMessage(error: any) {
  return error?.message || String(error);
}

async function appendScheduledRun(run: any) {
  await appendRun({
    ...run,
    result: run.result
      ? {
          ...run.result,
          discovery: compactDiscovery(run.result.discovery),
        }
      : run.result,
  });
}

async function finishWithoutCandidates(state: AutoSyncState, schedule: ReturnType<typeof getScheduleSummary>) {
  const finishedAt = new Date().toISOString();
  const result = {
    updated: 0,
    skipped: 0,
    ignored: 0,
    errors: 0,
    processed: 0,
    totalCandidates: 0,
    partial: false,
    discovery: state.discovery || [],
  };

  await appendScheduledRun({
    type: 'scheduled',
    ok: true,
    selectedListIds: state.selectedListIds || [],
    baselineUpdatedAfter: state.baselineUpdatedAfter || null,
    startedAt: state.startedAt,
    finishedAt,
    date: state.startedAt,
    schedule,
    result,
  });

  await saveAutoSyncState({ status: 'idle', lastFinishedAt: finishedAt });
  return { ok: true, skipped: true, reason: 'no_updated_tasks', startedAt: state.startedAt, finishedAt, result };
}

export async function runScheduledSync() {
  const requestStartedAt = Date.now();
  const config = await getConfig();
  const stats = await getStats();
  const schedule = getScheduleSummary(config, stats);
  const runningState = getRunningAutoSync(config);

  console.log('[scheduled] check', {
    intervalMinutes: schedule.intervalMinutes,
    lastScheduledRunAt: schedule.lastScheduledRunAt,
    nextScheduledRunAt: schedule.nextScheduledRunAt,
    due: schedule.due,
    running: Boolean(runningState),
  });

  if (runningState && isLeaseActive(runningState.leaseUntil)) {
    console.log('[scheduled] already running', compactProgress(runningState));
    return { ok: true, skipped: true, reason: 'already_running', progress: compactProgress(runningState), schedule };
  }

  let state = runningState;

  if (!state) {
    if (!schedule.due) {
      console.log('[scheduled] skipped not_due', schedule);
      return { ok: true, skipped: true, reason: 'not_due', schedule };
    }

    const selectedListIds = Array.isArray(config?.selectedListIds) ? config.selectedListIds : [];
    if (!selectedListIds.length) {
      const run = {
        type: 'scheduled',
        ok: false,
        error: 'No selected lists configured',
        date: new Date().toISOString(),
        schedule,
      };
      await appendScheduledRun(run);
      return { ok: false, error: run.error, schedule };
    }

    const startedAt = new Date().toISOString();
    const baselineUpdatedAfter = schedule.lastScheduledRunAt;
    const discoveryResult = await discoverUpdatedRootTasks(selectedListIds, baselineUpdatedAfter);

    state = {
      status: 'running',
      startedAt,
      baselineUpdatedAfter,
      selectedListIds,
      candidateTaskIds: discoveryResult.taskIds,
      cursorIndex: 0,
      batchSize: AUTO_SYNC_BATCH_SIZE,
      totals: emptyTotals(),
      discovery: discoveryResult.discovery,
      leaseUntil: null,
    };

    console.log('[scheduled] discovery complete', {
      startedAt,
      baselineUpdatedAfter,
      totalCandidates: discoveryResult.taskIds.length,
      discovery: compactDiscovery(discoveryResult.discovery),
    });

    if (!discoveryResult.taskIds.length) {
      return finishWithoutCandidates(state, schedule);
    }
  } else {
    state = {
      ...state,
      totals: state.totals || emptyTotals(),
      cursorIndex: state.cursorIndex || 0,
      batchSize: state.batchSize || AUTO_SYNC_BATCH_SIZE,
    };
    console.log('[scheduled] resume partial run', compactProgress(state));
  }

  state = withLease(state);
  await saveAutoSyncState(state);

  try {
    while (
      (state.cursorIndex || 0) < (state.candidateTaskIds?.length || 0) &&
      Date.now() - requestStartedAt < AUTO_SYNC_TIME_BUDGET_MS
    ) {
      const cursorIndex = state.cursorIndex || 0;
      const batchSize = state.batchSize || AUTO_SYNC_BATCH_SIZE;
      const batch = (state.candidateTaskIds || []).slice(cursorIndex, cursorIndex + batchSize);
      if (!batch.length) break;

      console.log('[scheduled] batch start', {
        cursorIndex,
        batchSize: batch.length,
        totalCandidates: state.candidateTaskIds?.length || 0,
      });

      const batchResult = await syncParentTasks(batch, {
        concurrency: AUTO_SYNC_CONCURRENCY,
        includeDetails: false,
      });

      const totals = state.totals || emptyTotals();
      mergeTotals(totals, batchResult, batch.length);
      state = withLease({
        ...state,
        cursorIndex: cursorIndex + batch.length,
        totals,
      });
      await saveAutoSyncState(state);

      console.log('[scheduled] batch complete', compactProgress(state));
    }

    const done = (state.cursorIndex || 0) >= (state.candidateTaskIds?.length || 0);
    if (!done) {
      state = { ...state, leaseUntil: null };
      await saveAutoSyncState(state);
      console.log('[scheduled] partial complete before timeout', compactProgress(state));
      return { ok: true, partial: true, reason: 'time_budget_reached', progress: compactProgress(state), schedule };
    }

    const finishedAt = new Date().toISOString();
    const result = {
      ...(state.totals || emptyTotals()),
      totalCandidates: state.candidateTaskIds?.length || 0,
      partial: false,
      discovery: state.discovery || [],
    };

    await appendScheduledRun({
      type: 'scheduled',
      ok: true,
      selectedListIds: state.selectedListIds || [],
      baselineUpdatedAfter: state.baselineUpdatedAfter || null,
      startedAt: state.startedAt,
      finishedAt,
      date: state.startedAt,
      schedule,
      result,
    });

    await saveAutoSyncState({ status: 'idle', lastFinishedAt: finishedAt });
    console.log('[scheduled] complete', { startedAt: state.startedAt, finishedAt, result: { ...result, discovery: compactDiscovery(result.discovery) } });

    return { ok: true, startedAt: state.startedAt, finishedAt, result, schedule };
  } catch (error: any) {
    const failedAt = new Date().toISOString();
    const failedState = {
      ...state,
      status: 'failed' as const,
      leaseUntil: null,
      failedAt,
      error: errorMessage(error),
    };
    await saveAutoSyncState(failedState);

    const run = {
      type: 'scheduled',
      ok: false,
      selectedListIds: state.selectedListIds || [],
      baselineUpdatedAfter: state.baselineUpdatedAfter || null,
      startedAt: state.startedAt,
      finishedAt: failedAt,
      date: state.startedAt || failedAt,
      error: errorMessage(error),
      progress: compactProgress(state),
      schedule,
    };
    await appendScheduledRun(run);
    console.error('[scheduled] failed', run);
    return { ok: false, error: run.error, progress: run.progress, schedule };
  }
}
