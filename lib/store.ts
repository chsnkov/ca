import { list, put } from '@vercel/blob';

const PATH = 'stats.json';

export type RunEntry = {
  type: string;
  date: string;
  event?: string;
};

export type Stats = {
  runs: RunEntry[];
};

function hasBlobToken() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function getStats(): Promise<Stats> {
  if (!hasBlobToken()) {
    return { runs: [] };
  }

  const blobs = await list({ prefix: PATH, token: process.env.BLOB_READ_WRITE_TOKEN });
  if (!blobs.blobs.length) return { runs: [] };

  const res = await fetch(blobs.blobs[0].url, { cache: 'no-store' });
  return (await res.json()) as Stats;
}

export async function saveStats(stats: Stats) {
  if (!hasBlobToken()) {
    console.warn('BLOB_READ_WRITE_TOKEN is not set; stats were not persisted.');
    return;
  }

  await put(PATH, JSON.stringify(stats), {
    access: 'public',
    addRandomSuffix: false,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}
