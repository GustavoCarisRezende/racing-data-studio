// Ephemeral, loopback-only synthetic UI. No native app, database or live provider.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
const outdir = resolve('examples/dist');
await mkdir(outdir, { recursive: true });
await build({ entryPoints: ['examples/visual-smoke.tsx'], bundle: true, nodePaths: [resolve('node_modules')], outdir, entryNames: 'smoke', format: 'iife', jsx: 'automatic', platform: 'browser', target: 'es2022', loader: { '.svg': 'file' }, assetNames: 'assets/[name]-[hash]', define: { 'process.env.NODE_ENV': '"production"' }, minify: true });
await writeFile(resolve(outdir, 'index.html'), '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RDS · Synthetic UI validation</title><link rel="stylesheet" href="/smoke.css"><body data-capture="{{ticket}}"><img hidden src="/ready.svg?ticket={{ticket}}" alt=""><div id="root"></div><script src="/smoke.js" defer></script></body></html>');
if (process.argv.includes('--build-only')) process.exit(0);
const waiting = new Map();
const completed = new Set();
const ready = response => { response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'); };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/ready' || pathname === '/ready.svg') {
      const ticket = url.searchParams.get('ticket');
      if (!ticket || !/^[a-f0-9-]{36}$/.test(ticket)) { res.writeHead(400).end(); return; }
      if (pathname === '/ready' && req.method === 'POST') { completed.add(ticket); const image = waiting.get(ticket); if (image) { ready(image); waiting.delete(ticket); } res.writeHead(204).end(); }
      else if (completed.has(ticket)) ready(res);
      else { waiting.set(ticket, res); res.on('close', () => waiting.delete(ticket)); }
      return;
    }
    const file = resolve(outdir, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(outdir + sep)) { res.writeHead(403).end(); return; }
    let body = await readFile(file);
    if (file.endsWith('index.html')) body = Buffer.from(body.toString().replaceAll('{{ticket}}', randomUUID()));
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'", 'Cache-Control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404).end(); }
});
const stop = () => { server.close(); server.closeAllConnections(); };
const timer = setTimeout(stop, 10 * 60_000); timer.unref();
process.on('SIGTERM', stop); process.on('SIGINT', stop);
server.listen(4179, '127.0.0.1', () => console.log(`Synthetic-only preview http://127.0.0.1:4179 (PID ${process.pid}; auto-closes after 10 minutes)`));
