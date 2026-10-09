import { createServer } from 'node:http';

/**
 * A deliberately broken app for the end-to-end test: the login API returns 500,
 * the page then crashes reading the missing token, a feature-flag call is slow,
 * one warning repeats, and the favicon is missing.
 */
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Acme — Sign in</title>
<style>body{font-family:system-ui;background:#eef1f6;display:grid;place-items:center;height:100vh;margin:0}
form{background:#fff;padding:24px;border-radius:12px;display:grid;gap:10px;width:280px}
button{background:#4f46e5;color:#fff;border:0;border-radius:6px;height:34px}</style></head>
<body>
<form id="signin">
  <strong>Sign in to Acme</strong>
  <label for="email">Email</label><input id="email" type="email">
  <label for="password">Password</label><input id="password" type="password">
  <button type="submit">Sign in</button>
</form>
<script>
  for (let i = 0; i < 20; i++) console.warn('legacyAuth() is deprecated and will be removed');
  fetch('/api/flags').then((r) => r.json());
  document.getElementById('signin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/v2/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret' },
      body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value }),
    });
    const data = await res.json();
    for (let i = 0; i < 3; i++) fetch('/api/v2/user/me');
    localStorage.setItem('token', data.session.token);
  });
</script>
</body></html>`;

export function startFixtureServer() {
  const server = createServer((req, res) => {
    const json = (status, body, delay = 0) =>
      setTimeout(() => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      }, delay);
    if (req.url === '/' || req.url === '/login') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(PAGE);
    }
    if (req.url === '/api/flags') return json(200, { newCheckout: false }, 1500);
    if (req.url === '/api/v2/auth/login')
      return json(500, { error: 'INTERNAL', message: 'session store unavailable' }, 300);
    if (req.url === '/api/v2/user/me') return json(401, { error: 'UNAUTHENTICATED' });
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
