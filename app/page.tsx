import { getStats } from '../lib/store';

export default async function Page() {
  const stats = await getStats();

  return (
    <main style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>ClickUp Sync Dashboard</h1>
      <pre>{JSON.stringify(stats, null, 2)}</pre>

      <form method="post" action="/api/run">
        <input name="token" placeholder="ADMIN TOKEN" />
        <button type="submit">Manual Run</button>
      </form>
    </main>
  );
}
