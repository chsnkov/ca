import { NextRequest, NextResponse } from 'next/server';
import { saveStats } from '../../../lib/store';
import { isRequestAuthenticated, unauthorizedRedirect } from '../../../lib/auth';

export async function POST(req: NextRequest) {
  if (!isRequestAuthenticated(req)) {
    return unauthorizedRedirect(req);
  }

  await saveStats({ runs: [] });
  return NextResponse.redirect(new URL('/', req.url), { status: 303 });
}
