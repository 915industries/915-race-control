#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// 915 Race Control — minimal login gate + static file server
//
// PURPOSE: put a username/password prompt in front of the existing static PWA.
// This is a privacy screen, NOT security. It keeps casual visitors out. It does
// not protect against anyone determined. Do not put anything sensitive behind it.
//
// WHY HTTP BASIC AUTH (and not a login page):
//   The PWA service worker (sw.js) is cache-first and caches any response where
//   `resp.ok` is true. A redirect to an HTML login page would poison the cache —
//   the SW would store the login page under the "/" key and keep serving it
//   forever. A 401 is never `ok`, so the SW skips it cleanly. No sw.js changes
//   needed, no cache invalidation, no risk to already-installed app instances.
//
// ZERO DEPENDENCIES — plain Node core only. No npm install required. This file
// is portable: drop it next to index.html in whatever tree Railway deploys.
//
// ENV VARS (required):
//   APP_USER      — username        (e.g. Racemarketing)
//   APP_PASSWORD  — password
// ENV VARS (optional):
//   PUBLIC_DIR    — directory to serve, default: this file's directory
//   PORT          — injected by Railway, default 8080
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// Railway's generated domain for this service targets port 8080, and Railpack's
// static server was listening there. Default to 8080 so the edge keeps routing
// correctly even if PORT isn't injected.
const PORT       = process.env.PORT || 8080;
const USER       = process.env.APP_USER || '';
const PASS       = process.env.APP_PASSWORD || '';
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || __dirname);
const REALM      = '915 Race Control';

// ─── Fail closed at boot ─────────────────────────────────────────────────────
// If the credentials are missing we refuse to start rather than silently
// serving the app to the whole internet. Railway keeps the PREVIOUS deployment
// live when a new one fails its healthcheck, so this is loud but not an outage.
if (!USER || !PASS) {
  console.error('[gate] FATAL: APP_USER and APP_PASSWORD must both be set. Refusing to start.');
  process.exit(1);
}

// ─── Constant-time credential check ──────────────────────────────────────────
// Length-independent: hash first, then compare fixed-width digests.
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest();
const USER_H = sha(USER);
const PASS_H = sha(PASS);

function credsOk(header) {
  if (!header || !/^Basic /i.test(header)) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch { return false; }
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  const u = sha(decoded.slice(0, i));
  const p = sha(decoded.slice(i + 1));
  // Bitwise & (not &&) so both comparisons always run — no early-exit timing leak.
  return crypto.timingSafeEqual(u, USER_H) & crypto.timingSafeEqual(p, PASS_H) ? true : false;
}

// ─── Static file serving ─────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.txt':  'text/plain; charset=utf-8',
  '.csv':  'text/csv; charset=utf-8',
  '.pdf':  'application/pdf',
};

// Never serve these, even if they sit in the deploy directory.
const DENY = new Set([
  'gate.js', 'server.js', 'auth.js', 'db.js', 'build.js', 'parseAim.js',
  'package.json', 'package-lock.json', 'railway.json',
  'deploy_creds.txt', 'deploy_commands.txt', 'deploy.md', '.env', '.env.example',
]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, 'bad request');
  }

  // Healthcheck stays public so Railway can probe the service.
  if (pathname === '/health') {
    return send(res, 200, JSON.stringify({ ok: true, t: Date.now() }),
      { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  }

  // ─── The gate ──────────────────────────────────────────────────────────────
  if (!credsOk(req.headers.authorization)) {
    return send(res, 401, 'Authentication required.', {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'method not allowed', { 'Allow': 'GET, HEAD' });
  }

  // Resolve inside PUBLIC_DIR only — blocks ../ traversal.
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, 'forbidden');
  }

  const base = path.basename(file).toLowerCase();
  if (base.startsWith('.') || DENY.has(base)) return send(res, 404, 'not found');

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      file = path.join(file, 'index.html');
      return stream(file);
    }
    if (err) return send(res, 404, 'not found');
    stream(file, st);
  });

  function stream(f, st) {
    fs.stat(f, (err, s) => {
      if (err || !s.isFile()) return send(res, 404, 'not found');
      const ext = path.extname(f).toLowerCase();
      const isHtml = ext === '.html';
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': s.size,
        // HTML + the service worker must never be edge-cached, or a stale shell
        // sticks around across deploys. Static assets can cache normally.
        'Cache-Control': (isHtml || path.basename(f) === 'sw.js')
          ? 'no-store, must-revalidate'
          : 'public, max-age=3600',
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
  console.log(`[gate] basic auth enabled for user "${USER}"`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
