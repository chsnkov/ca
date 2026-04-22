import { list, put } from '@vercel/blob';

const STATS_PATH = 'stats.json';
const CONFIG_PATH = 'config.json';

export async function getStats() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { runs: [] };
  const blobs = await list({ prefix: STATS_PATH, token: process.env.BLOB_READ_WRITE_TOKEN });
  if (!blobs.blobs.length) return { runs: [] };
  const res = await fetch(blobs.blobs[0].url, { cache: 'no-store' });
  return res.json();
}

export async function saveStats(stats: any) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(STATS_PATH, JSON.stringify(stats), { access: 'public', addRandomSuffix: false, token: process.env.BLOB_READ_WRITE_TOKEN });
}

export async function getConfig() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { selectedListIds: [], managedWebhooks: [] };
  const blobs = await list({ prefix: CONFIG_PATH, token: process.env.BLOB_READ_WRITE_TOKEN });
  if (!blobs.blobs.length) return { selectedListIds: [], managedWebhooks: [] };
  const res = await fetch(blobs.blobs[0].url, { cache: 'no-store' });
  return res.json();
}

export async function saveConfig(config: any) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(CONFIG_PATH, JSON.stringify(config), { access: 'public', addRandomSuffix: false, token: process.env.BLOB_READ_WRITE_TOKEN });
}

export async function appendRun(run: any) {
  const stats = await getStats();
  stats.runs = [run, ...(stats.runs || [])].slice(0, 100);
  await saveStats(stats);
}
