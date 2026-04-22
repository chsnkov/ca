import { getConfig, getStats } from '../lib/store';
import { getLists } from '../lib/clickup';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

type ListItem = { id: string; name: string };

function LoginForm({ error }: { error?: string }) {
  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: 420, margin: '40px auto' }}>
      <h1>Login</h1>

      {error && (
        <div style={{ background: '#300', color: '#f66', padding: 10 }}>
          Invalid credentials
        </div>
      )}

      <form method="post" action="/api/login" style={{ display: 'grid', gap: 12 }}>
        <input name="login" placeholder="Login" style={{ padding: 10 }} />
        <input name="password" type="password" placeholder="Password" style={{ padding: 10 }} />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}

function Dashboard({ stats, lists, selectedListId }: { stats: any; lists: ListItem[]; selectedListId?: string }) {
  return (
    <main style={{ padding: 20, fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>ClickUp Sync Dashboard</h1>
        <form method="post" action="/api/logout">
          <button type="submit">Logout</button>
        </form>
      </div>

      <section style={{ margin: '20px 0', padding: 16, border: '1px solid #333', borderRadius: 8 }}>
        <h2>Select List</h2>
        <form method="post" action="/api/config" style={{ display: 'grid', gap: 12 }}>
          <select name="selectedListId" defaultValue={selectedListId || ''} style={{ padding: 10 }}>
            <option value="">Select a ClickUp list</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.id})
              </option>
            ))}
          </select>
          <button type="submit">Save Selected List</button>
        </form>
      </section>

      <section style={{ margin: '20px 0', padding: 16, border: '1px solid #333', borderRadius: 8 }}>
        <h2>Manual Run</h2>
        <p>Runs a full sync for the selected list.</p>
        <form method="post" action="/api/run?redirect=1">
          <button type="submit">Run Full Sync</button>
        </form>
      </section>

      <section style={{ margin: '20px 0', padding: 16, border: '1px solid #333', borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Stats</h2>
          <form method="post" action="/api/clear-log">
            <button type="submit" style={{ background: '#300', color: '#f66', padding: '6px 12px' }}>
              Clear Log
            </button>
          </form>
        </div>

        <pre style={{ background: '#111', color: '#0f0', padding: 16, overflowX: 'auto' }}>
          {JSON.stringify(stats, null, 2)}
        </pre>
      </section>
    </main>
  );
}

export default async function Page(props: { searchParams?: Promise<{ error?: string }> }) {
  const cookieStore = await cookies();
  const isAuthed = cookieStore.get('ca_auth')?.value === '1';
  const searchParams = await props.searchParams;

  if (!isAuthed) {
    return <LoginForm error={searchParams?.error} />;
  }

  const [stats, config, lists] = await Promise.all([
    getStats(),
    getConfig(),
    getLists(),
  ]);

  const selectedListId = config?.selectedListIds?.[0] || process.env.CLICKUP_LIST_ID || '';

  return <Dashboard stats={stats} lists={lists} selectedListId={selectedListId} />;
}
