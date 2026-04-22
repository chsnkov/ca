import { getStats } from '../lib/store';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

function LoginForm() {
  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: 420, margin: '40px auto' }}>
      <h1>Login</h1>
      <form method="post" action="/api/login" style={{ display: 'grid', gap: 12 }}>
        <input name="login" placeholder="Login" style={{ padding: 10 }} />
        <input name="password" type="password" placeholder="Password" style={{ padding: 10 }} />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}

function Dashboard({ stats }: { stats: any }) {
  return (
    <main style={{ padding: 20, fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>ClickUp Sync Dashboard</h1>
        <form method="post" action="/api/logout">
          <button type="submit">Logout</button>
        </form>
      </div>

      <form method="post" action="/api/run?redirect=1" style={{ margin: '20px 0' }}>
        <button type="submit">Manual Run</button>
      </form>

      <pre style={{ background: '#111', color: '#0f0', padding: 16 }}>
        {JSON.stringify(stats, null, 2)}
      </pre>
    </main>
  );
}

export default async function Page() {
  const cookieStore = await cookies();
  const isAuthed = cookieStore.get('ca_auth')?.value === '1';

  if (!isAuthed) {
    return <LoginForm />;
  }

  const stats = await getStats();
  return <Dashboard stats={stats} />;
}
