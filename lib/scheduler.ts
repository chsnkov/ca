import { syncLists } from './clickup';
import { appendRun, getConfig, getStats } from './store';

const DEFAULT_SYNC_INTERVAL_MINUTES = 120;
const MIN_SYNC_INTERVAL_MINUTES = 5;
const MAX_SYNC_INTERVAL_MINUTES = 1440;
const SYNC_INTERVAL_STEP_MINUTES = 5;

export function normalizeSyncIntervalMinutes(value: unknown) {
  const parsed = Number(value);

  if (
    Number.isInteger(parsed) &&
    parsed >= MIN_SYNC_INTERVAL_MINUTES &&
    parsed <= MAX_SYNC_INTERVAL_MINUTES &&
    parsed % SYNC_INTERVAL_STEP_MINUTES === 0
  ) {
    return parsed;
  }

  return DEFAULT_SYNC_INTERVAL_MINUTES;
}

export function getLastScheduledRunAt(stats: any) {
  const runs = Array.isArray(stats?.runs) ? stats.runs : [];
  const lastRun = runs.find((run: any) => run?.type === 'scheduled' && run?.ok === true);
  const value = lastRun?.date || lastRun?.finishedAt || lastRun?.timestamp;

  if (!value) return null;

  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function getNextScheduledRunAt(lastRunAt: string | null, intervalMinutes: number) {
  if (!lastRunAt) return null;

  const next = new Date(new Date(lastRunAt).getTime() + intervalMinutes * 60 * 1000);
  return Number.isNaN(next.getTime()) ? null : next.toISOString();
}

export function getScheduleSummary(config: any, stats: any) {
  const legacyIntervalMinutes = config?.syncIntervalHours ? Number(config.syncIntervalHours) * 60 : undefined;
  const syncIntervalMinutes = normalizeSyncIntervalMinutes(config?.syncIntervalMinutes ?? legacyIntervalMinutes);
  const lastScheduledRunAt = getLastScheduledRunAt(stats);
  const nextScheduledRunAt = getNextScheduledRunAt(lastScheduledRunAt, syncIntervalMinutes);

  return {
    syncIntervalMinutes,
    lastScheduledRunAt,
    nextScheduledRunAt,
  };
}

export async function runScheduledSync() {
  const [config, stats] = await Promise.all([getConfig(), getStats()]);
  const schedule = getScheduleSummary(config, stats);
  const now = new Date();
  const dueAt = schedule.nextScheduledRunAt ? new Date(schedule.nextScheduledRunAt) : null;
  const isDue = !dueAt || now.getTime() >= dueAt.getTime();

  console.log('[scheduled] checked schedule', {
    isDue,
    now: now.toISOString(),
    syncIntervalMinutes: schedule.syncIntervalMinutes,
    lastScheduledRunAt: schedule.lastScheduledRunAt,
    nextScheduledRunAt: schedule.nextScheduledRunAt,
  });

  if (!isDue) {
    return {
      ok: true,
      skipped: true,
      reason: 'not_due',
      schedule,
      now: now.toISOString(),
    };
  }

  const rawListIds = Array.isArray(config?.selectedListIds) ? config.selectedListIds : [];
  const listIds = [...new Set((rawListIds as unknown[]).map(String).filter(Boolean))];

  if (!listIds.length) {
    await appendRun({
      type: 'scheduled',
      ok: false,
      error: 'no_list_configured',
      date: now.toISOString(),
      schedule,
    });

    console.warn('[scheduled] skipped without selected lists');

    return {
      ok: false,
      skipped: true,
      reason: 'no_list_configured',
      schedule,
      now: now.toISOString(),
    };
  }

  try {
    console.log('[scheduled] sync started', { listCount: listIds.length, listIds });

    const result = await syncLists(listIds);
    const finishedAt = new Date().toISOString();

    await appendRun({
      type: 'scheduled',
      ok: true,
      selectedListIds: listIds,
      result,
      date: finishedAt,
      schedule: {
        ...schedule,
        nextScheduledRunAt: getNextScheduledRunAt(finishedAt, schedule.syncIntervalMinutes),
      },
    });

    console.log('[scheduled] sync completed', {
      finishedAt,
      updated: result.updated,
      skipped: result.skipped,
      ignored: result.ignored,
      errors: result.errors,
    });

    return {
      ok: true,
      skipped: false,
      selectedListIds: listIds,
      result,
      finishedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'scheduled_sync_failed';

    console.error('[scheduled] sync failed', { error: message });

    await appendRun({
      type: 'scheduled',
      ok: false,
      error: message,
      date: new Date().toISOString(),
      schedule,
    });

    return {
      ok: false,
      skipped: false,
      error: message,
    };
  }
}
