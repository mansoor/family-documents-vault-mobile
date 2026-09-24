#!/usr/bin/env node
// Serves the web export (dist-web) and passes /api/ through to a vault, so
// the browser build talks to one origin and the vault needs no CORS rules.
// For the browser tests and for trying the app against a local stack:
//
//   APP_VARIANT=dev npx expo export --platform web --output-dir dist-web
//   FDV_DEV_API=http://localhost:8099 node scripts/serve-web.mjs
//
// Then open http://localhost:8098 and give the app that same address.
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', process.env.FDV_WEB_DIST ?? 'dist-web');
const port = Number(process.env.PORT ?? 8098);
// Loopback only, unless asked: this is a development tool, not a server.
const host = process.env.HOST ?? '127.0.0.1';
const vault = new URL(process.env.FDV_DEV_API ?? 'http://localhost:8099');

if (!existsSync(path.join(root, 'index.html'))) {
  console.error(`No web export at ${root}. Run: APP_VARIANT=dev npx expo export --platform web --output-dir dist-web`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

function proxy(req, res) {
  const client = vault.protocol === 'https:' ? https : http;
  const upstream = client.request(
    {
      protocol: vault.protocol,
      hostname: vault.hostname,
      port: vault.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: vault.host },
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('error', () => {
    // As if nothing were there: the app says the vault cannot be reached.
    res.destroy();
  });
  req.pipe(upstream);
}

function file(req, res) {
  const wanted = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let target = path.join(root, path.normalize(wanted));
  if (target !== root && !target.startsWith(root + path.sep)) {
    res.writeHead(400).end();
    return;
  }
  if (!existsSync(target) || statSync(target).isDirectory()) {
    // expo-router's single-page output: every route is index.html.
    const html = `${target}.html`;
    target = existsSync(html) ? html : path.join(root, 'index.html');
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(target).pipe(res);
}

http
  .createServer((req, res) => (req.url?.startsWith('/api/') ? proxy(req, res) : file(req, res)))
  .listen(port, host, () => {
    console.log(`web build on http://${host}:${port}, /api/ from ${vault.origin}`);
  });
