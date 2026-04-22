import { get, list, put } from '@vercel/blob';

const STATS_PATH = 'stats.json';
const CONFIG_PATH = 'config.json';

async function readPrivateJson(pathname: string) {
  const result = await get(pathname, {
    access: 'private',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  if (!result || result.statusCode !== 200 || !result.stream) {
    return null;
  }

  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

export async function getStats() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { runs: [] };
  const blobs = await list({ prefix: STATS_PATH, token: process.env.BLOB_READ_WRITE_TOKEN });
  if (!blobs.blobs.length) return { runs: [] };
  return (await readPrivateJson(STATS_PATH)) ?? { runs: [] };
}

export async function saveStats(stats: any) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(STATS_PATH, JSON.stringify(stats), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

export async function getConfig() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { selectedListIds: [], managedWebhooks: [] };
  const blobs = await list({ prefix: CONFIG_PATH, token: process.env.BLOB_READ_WRITE_TOKEN });
  if (!blobs.blobs.length) return { selectedListIds: [], managedWebhooks: [] };
  return (await readPrivateJson(CONFIG_PATH)) ?? { selectedListIds: [], managedWebhooks: [] };
}

export async function saveConfig(config: any) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(CONFIG_PATH, JSON.stringify(config), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

export async function appendRun(run: any) {
  const stats = await getStats();
  stats.runs = [run, ...(stats.runs || [])].slice(0, 100);
  await saveStats(stats);
}
