import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import events from './api/events.mjs';
import notifications from './api/notifications.mjs';
import statistics from './api/statistics.mjs';
import restaurants from './api/restaurants.mjs';
import places from './api/places.mjs';
import connections from './api/connections.mjs';
import users from './api/users.mjs';
import workspace from './api/workspace.mjs';
import social from './api/social.mjs';
import { handleDutyRequest, isDutyRoute } from './duty-http.mjs';

const { PORT = '3000' } = process.env;

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/legacy.html', ['legacy.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/notifications.js', ['notifications.js', 'text/javascript; charset=utf-8']],
  ['/statistics.js', ['statistics.js', 'text/javascript; charset=utf-8']],
  ['/restaurants.js', ['restaurants.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/social.js', ['social.js', 'text/javascript; charset=utf-8']],
  ['/social.css', ['social.css', 'text/css; charset=utf-8']],
  ['/profile.js', ['profile.js', 'text/javascript; charset=utf-8']],
  ['/profile.css', ['profile.css', 'text/css; charset=utf-8']],
  ['/duties.js', ['duties.js', 'text/javascript; charset=utf-8']],
  ['/voice.js', ['voice.js', 'text/javascript; charset=utf-8']],
  ['/navigation.html', ['navigation.html', 'text/html; charset=utf-8']],
  ['/ship-map.css', ['ship-map.css', 'text/css; charset=utf-8']],
  ['/ship-map.mjs', ['ship-map.mjs', 'text/javascript; charset=utf-8']],
  ['/ship-canvas.mjs', ['ship-canvas.mjs', 'text/javascript; charset=utf-8']],
  ['/ship-data.mjs', ['ship-data.mjs', 'text/javascript; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.png', ['icon.png', 'image/png']],
  ['/icon-large.png', ['icon-large.png', 'image/png']]
]);

createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  try {
    if (path === '/api/events') return await events(req, res);
    if (path === '/api/places') return await places(req, res);
    if (path === '/api/connections') return await connections(req, res);
    if (path === '/api/users') return await users(req, res);
    if (path === '/api/notifications') return await notifications(req, res);
    if (path === '/api/statistics') return await statistics(req, res);
    if (path === '/api/restaurants') return await restaurants(req, res);
    if (path === '/api/workspace') return await workspace(req, res);
    if (path === '/api/social') return await social(req, res);
    if (isDutyRoute(path)) return await handleDutyRequest(path, req, res);
    const asset = assets.get(path);
    if (req.method !== 'GET' || !asset) return res.writeHead(404).end();
    const [file, contentType] = asset;
    let body = await readFile(new URL('dist/' + file, import.meta.url));
    if (file === 'index.html' || file === 'legacy.html') {
      body = body.toString('utf8').replace('<head>', '<head>\n<meta name="crewconnect-shared" content="yes">');
    }
    return res.writeHead(200, {'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff'}).end(body);
  } catch (error) {
    console.error('CrewConnect request failed', error.code ?? error.name);
    res.writeHead(503).end();
  }
}).listen(Number(PORT), process.env.HOST ?? '127.0.0.1');
