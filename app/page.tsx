import { getStats } from '../lib/store';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const cookieStore = await cookies();
  const isAuthed = cookieStore.get('ca_auth')?.value === '1';

  if (!isAuthed) {
    redirect('/login');
  }

  const stats = await getStats();

  return (
    <main style={{ padding: 20, fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>ClickUp Sync Dashboard</h1>
        <form method="post" action="/api/logout">
          <button type="submit">Logout</button>
        </form>
      </div>

      <p>Recent runs, webhook events, and manual sync control.</p>

      <form method="post" action="/api/run?redirect=1" style={{ margin: '20px 0' }}>
        <button type="submit">Manual Run</button>
      </form>

      <h2>Stats</h2>
      <pre style={{ background: '#111', color: '#0f0', padding: 16, overflowX: 'auto' }}>
        {JSON.stringify(stats, null, 2)}
      </pre>
    </main>
  );
}
