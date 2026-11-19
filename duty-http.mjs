import {Readable} from 'node:stream';
import {MongoClient} from 'mongodb';
import {createDutyApi} from './crew-duties.mjs';

const {MONGODB_URI, MONGODB_DATABASE = 'crewconnect', FRONTEND_ORIGIN} = process.env;
const db = MONGODB_URI ? new MongoClient(MONGODB_URI, {maxPoolSize: 5, serverSelectionTimeoutMS: 5000})
  .db(MONGODB_DATABASE) : undefined;
const dutyApi = createDutyApi(db, process.env);
const routes = new Set(['/api/duties', '/api/duties/completion', '/api/reports', '/api/reports/draft']);

export const isDutyRoute = path => routes.has(path);

export async function handleDutyRequest(path, req, res) {
  const crossOrigin = FRONTEND_ORIGIN && req.headers.origin === FRONTEND_ORIGIN;
  res.setHeader('Vary', 'Origin');
  if (crossOrigin) {
    res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Workspace-Token');
  }
  if (req.method === 'OPTIONS') return res.writeHead(crossOrigin ? 204 : 403).end();
  try {
    const request = new Request(new URL(path, 'http://localhost'), {
      method: req.method,
      headers: req.headers,
      ...(req.method === 'POST' ? {body: Readable.toWeb(req), duplex: 'half'} : {})
    });
    const response = await dutyApi(path, request);
    return res.writeHead(response.status, Object.fromEntries(response.headers))
      .end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('CrewConnect duties request failed', error.code ?? error.name);
    return res.writeHead(503, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'})
      .end(JSON.stringify({error: 'Serwer przydziałów jest chwilowo niedostępny.'}));
  }
}
