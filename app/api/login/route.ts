import { NextRequest, NextResponse } from 'next/server';
import { checkCreds, setAuthCookie } from '../../../lib/auth';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const login = String(form.get('login') || '');
  const password = String(form.get('password') || '');

  if (!checkCreds(login, password)) {
    return NextResponse.redirect(new URL('/?error=invalid_credentials', req.url), { status: 303 });
  }

  const res = NextResponse.redirect(new URL('/', req.url), { status: 303 });
  setAuthCookie(res);

  return res;
}
