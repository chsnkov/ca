import { get, put } from '@vercel/blob';

const STATS_PATH = 'stats.json';
const CONFIG_PATH = 'config.json';
const MAX_RUNS = 30;
const CACHE_TTL_MS = 2000;

const jsonCache = new Map<string, { value: any; expiresAt: number }>();

function getCached(pathname: string) {
  const cached = jsonCache.get(pathname);
  if (!cached || Date.now() > cached.expiresAt) return null;
  return cached.value;
}

function setCached(pathname: string, value: any) {
  jsonCache.set(pathname, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function fetchBlobJson(pathname: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;

  const cached = getCached(pathname);
  if (cached) return cached;

  const result = await get(pathname, {
    access: 'private',
    useCache: false,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  if (!result?.stream) return null;

  const value = await new Response(result.stream).json();
  setCached(pathname, value);
  return value;
}

export async function getStats() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { runs: [] };
  return (await fetchBlobJson(STATS_PATH)) ?? { runs: [] };
}

export async function saveStats(stats: any) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  const compactStats = {
    ...stats,
    runs: Array.isArray(stats?.runs) ? stats.runs.map(compactRun).slice(0, MAX_RUNS) : [],
  };

  await put(
    STATS_PATH,
    JSON.stringify(compactStats),
    {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    } as any,
  );
  setCached(STATS_PATH, compactStats);
}

export async function getConfig() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { selectedListIds: [], managedWebhooks: [] };
  return (
    (await fetchBlobJson(CONFIG_PATH)) ??
    { selectedListIds: [], managedWebhooks: [] }
  );
}

export async function saveConfig(config: any) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(
    CONFIG_PATH,
    JSON.stringify(config),
    {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    } as any,
  );
  setCached(CONFIG_PATH, config);
}

export async function appendRun(run: any) {
  await appendRuns([run]);
}

export async function appendRuns(newRuns: any[]) {
  if (!newRuns.length) return;

  const stats = await getStats();
  const runs = Array.isArray(stats?.runs) ? stats.runs : [];
  await saveStats({
    ...stats,
    runs: [...newRuns.map(compactRun), ...runs].slice(0, MAX_RUNS),
  });
}

function compactSyncResult(result: any) {
  if (!result || typeof result !== 'object') return result;

  const compact: any = {};
  for (const key of [
    'ok',
    'updated',
    'skipped',
    'ignored',
    'errors',
    'partial',
    'processedRootTasks',
    'candidateRootTasks',
    'totalRootTasks',
  ]) {
    if (result[key] !== undefined) compact[key] = result[key];
  }

  if (Array.isArray(result.discovery)) {
    compact.discovery = result.discovery.map((item: any) => ({
      listId: item?.listId,
      pagesFetched: item?.pagesFetched,
      totalApiItems: item?.totalApiItems,
      totalRootTasks: item?.totalRootTasks,
    }));
  }

  if (Array.isArray(result.details)) {
    compact.detailsSummary = summarizeDetails(result.details);
  }

  return Object.keys(compact).length ? compact : result;
}

function summarizeDetails(details: any[]) {
  const byAction: Record<string, number> = {};
  const byReason: Record<string, number> = {};

  for (const detail of details) {
    const action = detail?.action ? String(detail.action) : 'unknown';
    byAction[action] = (byAction[action] || 0) + 1;

    if (detail?.reason) {
      const reason = String(detail.reason);
      byReason[reason] = (byReason[reason] || 0) + 1;
    }
  }

  return {
    total: details.length,
    byAction,
    byReason,
  };
}

function compactSetupResult(result: any) {
  if (!result || typeof result !== 'object') return result;

  return {
    teamId: result.teamId,
    endpoint: result.endpoint,
    selectedListCount: Array.isArray(result.selectedListIds) ? result.selectedListIds.length : undefined,
    deletedWebhookCount: Array.isArray(result.deletedWebhooks) ? result.deletedWebhooks.length : undefined,
    createdWebhookCount: Array.isArray(result.createdWebhooks) ? result.createdWebhooks.length : undefined,
    createdWebhooks: Array.isArray(result.createdWebhooks)
      ? result.createdWebhooks.map((webhook: any) => ({
          id: webhook?.id,
          listId: webhook?.listId,
          listName: webhook?.listName,
          events: webhook?.events,
        }))
      : undefined,
  };
}

function compactRun(run: any) {
  if (!run || typeof run !== 'object') return run;

  return {
    ...run,
    result: compactSyncResult(run.result),
    setupResult: compactSetupResult(run.setupResult),
  };
}
