import { NextRequest, NextResponse } from 'next/server';
import { clearAuthCookie } from '../../../lib/auth';

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/', req.url), { status: 303 });
  clearAuthCookie(res);
  return res;
}
