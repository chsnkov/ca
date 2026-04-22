import { list, put } from '@vercel/blob';

const PATH = 'stats.json';

export async function getStats() {
  const blobs = await list({ prefix: PATH });
  if (!blobs.blobs.length) return { runs: [] };

  const res = await fetch(blobs.blobs[0].url);
  return res.json();
}

export async function saveStats(stats: any) {
  await put(PATH, JSON.stringify(stats), { access: 'public', addRandomSuffix: false });
}
