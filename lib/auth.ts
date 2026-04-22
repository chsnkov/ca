import { cookies } from 'next/headers';
import { createHash } from 'crypto';

const COOKIE = 'ca_session';

const hash = (v: string) => createHash('sha256').update(v).digest('hex');

export async function isAuthenticated() {
  const c = (await cookies()).get(COOKIE)?.value;
  const expected = hash(`${process.env.ADMIN_LOGIN}:${process.env.ADMIN_PASSWORD}`);
  return c === expected;
}

export async function login() {
  (await cookies()).set(COOKIE, hash(`${process.env.ADMIN_LOGIN}:${process.env.ADMIN_PASSWORD}`));
}

export async function logout() {
  (await cookies()).set(COOKIE, '', { maxAge: 0 });
}

export function checkCreds(l: string, p: string) {
  return l === process.env.ADMIN_LOGIN && p === process.env.ADMIN_PASSWORD;
}
