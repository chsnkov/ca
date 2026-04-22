export default function LoginPage() {
  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: 400, margin: '0 auto' }}>
      <h1>Login</h1>
      <p>Enter admin token</p>

      <form method="post" action="/api/login">
        <input name="token" placeholder="Admin token" style={{ width: '100%', padding: 8 }} />
        <button type="submit" style={{ marginTop: 10 }}>Login</button>
      </form>
    </main>
  );
}
