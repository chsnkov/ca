import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const token = String(form.get('token') || '');

  if (token !== process.env.ADMIN_TOKEN) {
    return NextResponse.redirect(new URL('/login', req.url));
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
