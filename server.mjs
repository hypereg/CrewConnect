import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import workspace from './api/workspace.mjs';

const { PORT = '3000' } = process.env;

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/crew-profiles.js', ['crew-profiles.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.png', ['icon.png', 'image/png']],
  ['/icon-large.png', ['icon-large.png', 'image/png']]
]);

createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  try {
    if (path === '/api/workspace') return await workspace(req, res);
    const asset = assets.get(path);
    if (req.method !== 'GET' || !asset) return res.writeHead(404).end();
    const [file, contentType] = asset;
    const body = await readFile(new URL('dist/' + file, import.meta.url));
    return res.writeHead(200, {'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff'}).end(body);
  } catch (error) {
    console.error('CrewConnect request failed', error.code ?? error.name);
    res.writeHead(503).end();
  }
}).listen(Number(PORT), process.env.HOST ?? '127.0.0.1');
