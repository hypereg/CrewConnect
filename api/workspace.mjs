import { createHash, randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { discoveryId, discoveryFields } from '../discovery-profile.mjs';

const { MONGODB_URI, MONGODB_DATABASE = 'crewconnect', FRONTEND_ORIGIN } = process.env;
let client;

function workspaceDatabase() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI is required.');
  if (!client) {
    client = new MongoClient(MONGODB_URI, {maxPoolSize: 5, serverSelectionTimeoutMS: 5000});
  }
  return client.db(MONGODB_DATABASE);
}

export function validProfile(profile) {
  return profile && typeof profile.id === 'string' &&
    /^profile-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(profile.id) &&
    typeof profile.name === 'string' && profile.name.trim().length > 0 && profile.name.length <= 80 &&
    !/\p{Cc}/u.test(profile.name) &&
    typeof profile.role === 'string' && profile.role.length <= 60 &&
    typeof profile.bio === 'string' && profile.bio.length <= 300 &&
    (profile.intent === undefined || ['', 'dates', 'relationship', 'friendship', 'activities'].includes(profile.intent)) &&
    (profile.icebreaker === undefined || (typeof profile.icebreaker === 'string' && profile.icebreaker.length <= 120)) &&
    (profile.age == null || (Number.isInteger(profile.age) && profile.age >= 18 && profile.age <= 120)) &&
    (profile.gender === undefined || ['', 'women', 'men'].includes(profile.gender)) &&
    Array.isArray(profile.interests) && profile.interests.length <= 6 &&
    profile.interests.every(interest => typeof interest === 'string' && interest.trim() && interest.length <= 28);
}

const recoveryDigest = code => createHash('sha256').update('crewconnect-recovery:' + code).digest('hex');
const workspaceId = req => req.headers.cookie?.match(/(?:^|; *)crew_workspace=([a-f0-9]{64})(?:;|$)/)?.[1];
function setWorkspaceCookie(res, id) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `crew_workspace=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${id ? 31536000 : 0}${secure}`);
}

async function accountSession(req, res) {
  const origin = req.headers.origin;
  if (req.headers['sec-fetch-site'] === 'cross-site' || !origin || new URL(origin).host !== req.headers.host) {
    return res.writeHead(403).end();
  }
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') return res.writeHead(415).end();
  let data = req.body;
  if (data === undefined) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1024) return res.writeHead(413).end();
    }
    try { data = JSON.parse(raw); } catch { return res.writeHead(400).end(); }
  }
  if (typeof data?.code !== 'string' || !/^[a-f0-9]{64}$/.test(data.code)) return res.writeHead(400).end();
  const store = workspaceDatabase().collection('workspaces');
  const recovery = recoveryDigest(data.code);
  if (data.action === 'logout') {
    const id = workspaceId(req);
    if (!id) return res.writeHead(401).end();
    const result = await store.updateOne({_id: id, 'snapshot.userProfile.id': {$exists: true}}, {$set: {recovery}});
    if (!result.matchedCount) return res.writeHead(409).end();
    setWorkspaceCookie(res, '');
    return res.writeHead(204).end();
  }
  if (data.action === 'login') {
    const account = await store.findOneAndUpdate({recovery}, {$unset: {recovery: ''}}, {projection: {_id: 1, snapshot: 1}});
    if (!account) return res.writeHead(401).end();
    setWorkspaceCookie(res, account._id);
    return res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(account.snapshot));
  }
  return res.writeHead(400).end();
}

export default async function workspace(req, res) {
  try {
    const browserOrigin = req.headers.origin;
    const crossOrigin = Boolean(FRONTEND_ORIGIN && browserOrigin === FRONTEND_ORIGIN);
    if (crossOrigin) {
      res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Expose-Headers', 'X-Workspace-Token');
    }
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.writeHead(crossOrigin ? 204 : 403).end();
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'POST' && !crossOrigin) return await accountSession(req, res);
    if (!['GET', 'PUT'].includes(req.method)) return res.writeHead(405).end();
    let id = crossOrigin ? req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] :
      req.headers.cookie?.match(/(?:^|; *)crew_workspace=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (!id) {
      if (req.method === 'PUT') return res.writeHead(401).end();
      id = randomBytes(32).toString('hex');
      if (crossOrigin) res.setHeader('X-Workspace-Token', id);
      else {
        setWorkspaceCookie(res, id);
      }
    }
    if (req.method === 'GET') {
      const workspace = await workspaceDatabase().collection('workspaces').findOne({_id: id}, {projection: {snapshot: 1}});
      return res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(workspace?.snapshot ?? null));
    }
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return res.writeHead(415).end();
    let snapshot = req.body;
    if (snapshot === undefined) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 512 * 1024) return res.writeHead(413).end();
        chunks.push(chunk);
      }
      try {
        snapshot = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return res.writeHead(400).end();
      }
    } else if (Buffer.byteLength(JSON.stringify(snapshot)) > 512 * 1024) {
      return res.writeHead(413).end();
    }
    if (!snapshot || typeof snapshot.member !== 'string' || !Array.isArray(snapshot.events) || !Array.isArray(snapshot.reports) ||
        (snapshot.userProfile !== undefined && !validProfile(snapshot.userProfile))) {
      return res.writeHead(400).end();
    }
    const db = workspaceDatabase();
    const filter = {_id: id};
    const previous = await db.collection('workspaces').findOne(filter, {projection: {'snapshot.userProfile': 1}});
    const updated = snapshot.userProfile;
    if (updated && JSON.stringify(previous?.snapshot?.userProfile) !== JSON.stringify(updated)) {
      await db.collection('discovery_profiles').updateOne({_id: discoveryId(id)}, {$set: discoveryFields(updated)});
    }
    await db.collection('workspaces').updateOne(
      {_id: id},
      {$set: {snapshot, updatedAt: new Date()}},
      {upsert: true}
    );
    return res.writeHead(204).end();
  } catch (error) {
    console.error('CrewConnect workspace request failed', error.code ?? error.name);
    return res.writeHead(503).end();
  }
}
