import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const login = String(form.get('login') || '');
  const password = String(form.get('password') || '');

  if (
    login !== process.env.ADMIN_LOGIN ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return NextResponse.redirect(new URL('/?error=invalid_credentials', req.url), { status: 303 });
  }

  const res = NextResponse.redirect(new URL('/', req.url), { status: 303 });

  res.cookies.set('ca_auth', '1', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
}
