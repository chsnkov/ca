import { NextRequest, NextResponse } from 'next/server';
import { saveStats } from '../../../lib/store';

export async function POST(req: NextRequest) {
  await saveStats({ runs: [] });
  return NextResponse.redirect(new URL('/', req.url), { status: 303 });
}
