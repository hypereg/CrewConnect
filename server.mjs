import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MongoClient } from 'mongodb';

const { MONGODB_URI, MONGODB_DATABASE = 'crewconnect', PORT = '3000' } = process.env;
if (!MONGODB_URI) throw new Error('Set MONGODB_URI before starting.');
const client = new MongoClient(MONGODB_URI, {maxPoolSize: 5, serverSelectionTimeoutMS: 5000});
const db = client.db(MONGODB_DATABASE);
try {
  await db.command({ping: 1});
} catch (error) {
  await client.close();
  console.error('MongoDB connection failed:', error.code ?? error.name);
  process.exit(1);
}
const workspaces = db.collection('workspaces');

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
        const workspace = await workspaces.findOne({_id: id}, {projection: {snapshot: 1}});
        return res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(workspace?.snapshot ?? null));
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
      await workspaces.updateOne(
        {_id: id},
        {$set: {snapshot, updatedAt: new Date()}},
        {upsert: true}
      );
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
