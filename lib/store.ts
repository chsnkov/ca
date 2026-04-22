import { list, put } from '@vercel/blob';

const STATS_PATH = 'stats.json';
const CONFIG_PATH = 'config.json';

async function fetchBlobJson(pathname: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;

  const blobs = await list({
    prefix: pathname,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  const blob = blobs.blobs.find((item) => item.pathname === pathname) || blobs.blobs[0];
  if (!blob) return null;

  const url = blob.downloadUrl || blob.url;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Blob read failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export async function getStats() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { runs: [] };
  return (await fetchBlobJson(STATS_PATH)) ?? { runs: [] };
}

export async function saveStats(stats: any) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(
    STATS_PATH,
    JSON.stringify(stats),
    {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    } as any,
  );
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
}

export async function appendRun(run: any) {
  const stats = await getStats();
  stats.runs = [run, ...(stats.runs || [])].slice(0, 100);
  await saveStats(stats);
}
