import { NextRequest, NextResponse } from 'next/server';
import { getStats, saveStats } from '@/lib/store';

export async function POST(req: NextRequest) {
  const body = await req.formData();
  const token = body.get('token');

  if (token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const stats = await getStats();
  stats.runs = stats.runs || [];

  stats.runs.push({ type: 'manual', date: new Date().toISOString() });

  await saveStats(stats);

  return NextResponse.json({ ok: true });
}
