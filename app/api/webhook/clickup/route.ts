import { NextRequest, NextResponse } from 'next/server';
import { getStats, saveStats } from '../../../../lib/store';

export async function POST(req: NextRequest) {
  const payload = await req.json();

  const stats = await getStats();
  stats.runs = stats.runs || [];

  stats.runs.push({
    type: 'webhook',
    event: payload.event,
    date: new Date().toISOString()
  });

  await saveStats(stats);

  return NextResponse.json({ ok: true });
}
