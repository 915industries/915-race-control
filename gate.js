#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// 915 Race Control — login gate + static file server
//
// PURPOSE: keep random passers-by out of the app. This is a privacy screen,
// NOT security. Shared credentials, no per-user revocation. Don't put anything
// in the app you'd be hurt by leaking.
//
// WHY AN IN-PAGE FORM INSTEAD OF THE BROWSER POPUP:
//   The PWA service worker (sw.js) intercepts every same-origin GET. When the
//   server answers a navigation with 401, the SW hands that response straight
//   to the page — and the browser NEVER shows its built-in auth dialog, because
//   the response came from the SW rather than the network. Result: a dead page
//   with nowhere to type. Rendering our own <form> sidesteps that entirely.
//
//   We still answer with HTTP status 401 (not 200). sw.js only caches responses
//   where `resp.ok` is true, so a 401 is never written to the cache. That means
//   the login page can't poison the "/" cache key and get served forever.
//
// ZERO DEPENDENCIES — Node core only. No npm install needed.
//
// ENV VARS (required):
//   APP_USER      — username (case-insensitive, e.g. racemarketing)
//   APP_PASSWORD  — password (exact, case-sensitive)
// ENV VARS (optional):
//   PUBLIC_DIR    — directory to serve, default: this file's directory
//   PORT          — injected by Railway, default 8080
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT       = process.env.PORT || 8080;
const USER       = (process.env.APP_USER || '').trim();
const PASS       = process.env.APP_PASSWORD || '';
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || __dirname);

const COOKIE     = 'rc_auth';
const MAX_AGE    = 60 * 60 * 24 * 180;   // 180 days — log in about twice a year

// ─── Fail closed at boot ─────────────────────────────────────────────────────
// Railway keeps the PREVIOUS deployment live when a new one fails its
// healthcheck, so this is loud but does not take the site down.
if (!USER || !PASS) {
  console.error('[gate] FATAL: APP_USER and APP_PASSWORD must both be set. Refusing to start.');
  process.exit(1);
}

// ─── Credential checks ───────────────────────────────────────────────────────
// Hash first so comparisons are fixed-width and length-independent.
const sha    = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest();
const USER_H = sha(USER.toLowerCase());   // username is case-insensitive
const PASS_H = sha(PASS);                 // password is exact

// Session token derived from the credentials themselves. Deterministic, so no
// session store is needed — and rotating APP_PASSWORD invalidates every existing
// cookie automatically, which is exactly what you want after sharing it around.
const TOKEN = crypto.createHmac('sha256', USER.toLowerCase() + '\0' + PASS)
                    .update('rc-gate-v1').digest('hex');
const TOKEN_H = sha(TOKEN);

const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

function loggedIn(req) {
  const raw = req.headers.cookie;
  if (!raw) return false;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== COOKIE) continue;
    return eq(sha(part.slice(i + 1).trim()), TOKEN_H);
  }
  return false;
}

function credsOk(u, p) {
  // Bitwise & so both comparisons always run — no early-exit timing leak.
  return (eq(sha(String(u || '').trim().toLowerCase()), USER_H)
        & eq(sha(String(p || '')), PASS_H)) ? true : false;
}

// ─── Login page ──────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage(msg) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>915 Race Control</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
 background:#0d0d0f;color:#eee;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
 padding:24px}
.card{width:100%;max-width:360px}
h1{font-size:20px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin:0 0 4px;color:#fff}
p.sub{margin:0 0 28px;color:#8a8a92;font-size:13px;letter-spacing:.06em;text-transform:uppercase}
label{display:block;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#8a8a92;margin:0 0 6px}
input{width:100%;padding:13px 14px;margin:0 0 18px;background:#17171b;color:#fff;
 border:1px solid #2a2a31;border-radius:8px;font-size:16px}
input:focus{outline:none;border-color:#e8622c}
button{width:100%;padding:14px;background:#e8622c;color:#fff;border:0;border-radius:8px;
 font-size:15px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
button:active{opacity:.85}
.err{background:#2a1416;border:1px solid #5c2027;color:#ff9b9b;padding:10px 12px;
 border-radius:8px;margin:0 0 18px;font-size:13px}
</style></head><body>
<div class="card">
<h1>915 Race Control</h1>
<p class="sub">Authorized access</p>
${msg ? `<div class="err">${esc(msg)}</div>` : ''}
<form method="POST" action="/__login">
<label for="u">Username</label>
<input id="u" name="u" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required autofocus>
<label for="p">Password</label>
<input id="p" name="p" type="password" autocomplete="current-password" required>
<button type="submit">Enter</button>
</form>
</div></body></html>`;
}

// ─── Static serving ──────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.pdf': 'application/pdf', '.zip': 'application/zip',
};

// Never serve these even if they sit in the deploy directory.
const DENY = new Set(['gate.js', 'package.json', 'package-lock.json', 'railway.json',
                      '.env', '.env.example', 'dockerfile']);

const send = (res, status, body, headers = {}) => { res.writeHead(status, headers); res.end(body); };

const sendLogin = (res, msg) => send(res, 401, loginPage(msg), {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
});

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { return send(res, 400, 'bad request'); }

  // Public healthcheck for Railway.
  if (pathname === '/health') {
    return send(res, 200, JSON.stringify({ ok: true, t: Date.now() }),
      { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  }

  // ─── Login submit ──────────────────────────────────────────────────────────
  // POST, so sw.js ignores it entirely (its fetch handler only touches GETs).
  if (pathname === '/__login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      const f = new URLSearchParams(body);
      if (!credsOk(f.get('u'), f.get('p'))) return sendLogin(res, 'Wrong username or password.');
      res.writeHead(303, {
        'Location': '/',
        'Set-Cookie': `${COOKIE}=${TOKEN}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        'Cache-Control': 'no-store',
      });
      res.end();
    });
    return;
  }

  if (pathname === '/__logout') {
    return send(res, 303, '', {
      'Location': '/',
      'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      'Cache-Control': 'no-store',
    });
  }

  // ─── The gate ──────────────────────────────────────────────────────────────
  if (!loggedIn(req)) return sendLogin(res, '');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'method not allowed', { 'Allow': 'GET, HEAD' });
  }

  // Resolve inside PUBLIC_DIR only — blocks ../ traversal.
  const rel  = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let   file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, 'forbidden');
  }

  const base = path.basename(file).toLowerCase();
  if (base.startsWith('.') || DENY.has(base)) return send(res, 404, 'not found');

  fs.stat(file, (err, st) => {
    if (err) return send(res, 404, 'not found');
    stream(st.isDirectory() ? path.join(file, 'index.html') : file);
  });

  function stream(f) {
    fs.stat(f, (err, s) => {
      if (err || !s.isFile()) return send(res, 404, 'not found');
      const ext = path.extname(f).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': s.size,
        // HTML and the service worker must never be edge-cached, or a stale
        // shell survives across deploys. Other assets cache normally.
        'Cache-Control': (ext === '.html' || path.basename(f) === 'sw.js')
          ? 'no-store, must-revalidate' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(f).on('error', () => res.end()).pipe(res);
    });
  }
});

server.listen(PORT, () => {
  console.log(`[gate] 915 Race Control up on :${PORT}`);
  console.log(`[gate] serving ${PUBLIC_DIR}`);
  console.log(`[gate] login form enabled for user "${USER}" (case-insensitive)`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
