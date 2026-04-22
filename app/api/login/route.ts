import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const login = String(form.get('login') || '');
  const password = String(form.get('password') || '');

  if (
    login !== process.env.ADMIN_LOGIN ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  const res = NextResponse.redirect(new URL('/', req.url));

  res.cookies.set('ca_auth', '1', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });

  return res;
}
