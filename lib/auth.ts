import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const AUTH_COOKIE = 'ca_auth';

export function checkCreds(login: string, password: string) {
  return login === process.env.ADMIN_LOGIN && password === process.env.ADMIN_PASSWORD;
}

export async function isAuthenticated() {
  return (await cookies()).get(AUTH_COOKIE)?.value === '1';
}

export function isRequestAuthenticated(req: NextRequest) {
  return req.cookies.get(AUTH_COOKIE)?.value === '1';
}

export function setAuthCookie(res: NextResponse) {
  res.cookies.set(AUTH_COOKIE, '1', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearAuthCookie(res: NextResponse) {
  res.cookies.set(AUTH_COOKIE, '', { maxAge: 0, path: '/' });
}

export function unauthorizedRedirect(req: NextRequest) {
  return NextResponse.redirect(new URL('/?error=unauthorized', req.url), { status: 303 });
}
