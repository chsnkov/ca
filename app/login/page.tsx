export default async function LoginPage(props: { searchParams?: Promise<{ error?: string }> }) {
  const searchParams = await props.searchParams;

  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: 400, margin: '0 auto' }}>
      <h1>Login</h1>
      {searchParams?.error && (
        <div style={{ background: '#300', color: '#f66', padding: 10, marginBottom: 12 }}>
          Invalid credentials
        </div>
      )}

      <form method="post" action="/api/login" style={{ display: 'grid', gap: 12 }}>
        <input name="login" placeholder="Login" style={{ padding: 8 }} />
        <input name="password" type="password" placeholder="Password" style={{ padding: 8 }} />
        <button type="submit" style={{ marginTop: 10 }}>Login</button>
      </form>
    </main>
  );
}
