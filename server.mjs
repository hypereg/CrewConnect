import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const { MYSQL_HOST, MYSQL_PORT = '3306', MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD, PORT = '3000' } = process.env;
if (!MYSQL_HOST || !MYSQL_DATABASE || !MYSQL_USER || !MYSQL_PASSWORD) {
  throw new Error('Set MYSQL_HOST, MYSQL_DATABASE, MYSQL_USER and MYSQL_PASSWORD before starting.');
}
const pool = mysql.createPool({
  host: MYSQL_HOST, port: Number(MYSQL_PORT), database: MYSQL_DATABASE,
  user: MYSQL_USER, password: MYSQL_PASSWORD, connectionLimit: 5, connectTimeout: 5000
});
await pool.query(`CREATE TABLE IF NOT EXISTS crewconnect_workspaces (
  workspace_id CHAR(64) PRIMARY KEY,
  snapshot JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`);

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.png', ['icon.png', 'image/png']],
  ['/icon-large.png', ['icon-large.png', 'image/png']]
]);

createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  try {
    if (path === '/api/workspace' && ['GET', 'PUT'].includes(req.method)) {
      res.setHeader('Cache-Control', 'no-store');
      let id = req.headers.cookie?.match(/(?:^|; *)crew_workspace=([a-f0-9]{64})(?:;|$)/)?.[1];
      if (!id) {
        if (req.method === 'PUT') return res.writeHead(401).end();
        id = randomBytes(32).toString('hex');
        const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        res.setHeader('Set-Cookie', `crew_workspace=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}`);
      }
      if (req.method === 'GET') {
        const [rows] = await pool.execute('SELECT snapshot FROM crewconnect_workspaces WHERE workspace_id = ?', [id]);
        const snapshot = rows[0]?.snapshot ?? null;
        const json = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
        return res.writeHead(200, {'Content-Type': 'application/json'}).end(json);
      }
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return res.writeHead(415).end();
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 512 * 1024) return res.writeHead(413).end();
        chunks.push(chunk);
      }
      let snapshot;
      try {
        snapshot = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return res.writeHead(400).end();
      }
      if (!snapshot || typeof snapshot.member !== 'string' || !Array.isArray(snapshot.events) || !Array.isArray(snapshot.reports)) {
        return res.writeHead(400).end();
      }
      const json = JSON.stringify(snapshot);
      await pool.execute(`INSERT INTO crewconnect_workspaces (workspace_id, snapshot)
        VALUES (?, ?) ON DUPLICATE KEY UPDATE snapshot = ?`, [id, json, json]);
      return res.writeHead(204).end();
    }
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
