import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {discoveryId, discoveryFields} from '../discovery-profile.mjs';
import {recoveryDigest} from '../workspace-session.mjs';

const {MONGODB_URI, MONGODB_DATABASE = 'crewconnect'} = process.env;
let connecting;
const send = (res, status, data) => res.writeHead(status, {'Content-Type': 'application/json'}).end(JSON.stringify(data));
const hash = value => createHash('sha256').update('crewconnect-admin:' + value).digest();
const random = () => randomBytes(32).toString('hex');

function database() {
  if (!connecting) {
    connecting = new MongoClient(MONGODB_URI, {serverSelectionTimeoutMS: 5000}).connect()
      .catch(error => { connecting = undefined; throw error; });
  }
  return connecting.then(client => client.db(MONGODB_DATABASE));
}

export async function crewAdminDigest(db) {
  if (!db && !MONGODB_URI) return null;
  const directory = db ?? await database();
  const record = await directory.collection('crewAdminConfig').findOne({_id: 'access'}, {projection: {digest: 1}});
  return /^[a-f0-9]{64}$/.test(record?.digest ?? '') ? Buffer.from(record.digest, 'hex') : null;
}

export function matchesCrewAdminKey(access, digest) {
  return Boolean(digest && typeof access === 'string' && /^[a-f0-9]{64}$/.test(access) &&
    timingSafeEqual(hash(access), digest));
}

async function input(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new SyntaxError();
  }
  return JSON.parse(raw);
}

export default async function users(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const access = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!access) return send(res, 401, {error: 'Wpisz klucz administratora.'});
    const db = await database();
    if (!matchesCrewAdminKey(access, await crewAdminDigest(db))) {
      return send(res, 401, {error: 'Nieprawidłowy klucz administratora.'});
    }
    const workspaces = db.collection('workspaces');
    const profiles = db.collection('discovery_profiles');
    const audit = db.collection('crewAdminAudit');
    if (req.method === 'GET') {
      const [records, cards, logs] = await Promise.all([
        workspaces.find({'snapshot.userProfile.id': {$exists: true}}, {projection: {'snapshot.userProfile': 1, archived: 1}}).toArray(),
        profiles.find({}, {projection: {_id: 1}}).toArray(),
        audit.find({}, {projection: {_id: 0, userId: 0}}).sort({at: -1}).limit(50).toArray()
      ]);
      const published = new Set(cards.map(card => card._id));
      return send(res, 200, {logs, users: records.map(row => {
        const profile = row.snapshot.userProfile;
        return {id: discoveryId(row._id), name: profile.name, role: profile.role,
          archived: row.archived === true, published: published.has(discoveryId(row._id))};
      }).sort((a, b) => a.name.localeCompare(b.name, 'pl'))});
    }
    if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json') {
      return send(res, 405, {error: 'Niedozwolona operacja.'});
    }
    if (!req.headers.origin || req.headers['sec-fetch-site'] === 'cross-site' ||
        new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, {error: 'Niedozwolone źródło.'});
    const body = await input(req);
    const client = await connecting;
    const result = (status, payload) => ({status, payload});
    const response = await client.withSession(session => session.withTransaction(async () => {
      const record = (action, name, userId) => audit.insertOne({action, name, userId, at: new Date()}, {session});
      if (body?.action === 'create') {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const role = typeof body.role === 'string' ? body.role.trim() : '';
        if (!name || name.length > 80 || /\p{Cc}/u.test(name) || role.length > 60) return result(400, {error: 'Sprawdź nazwę i rolę.'});
        const userProfile = {id: 'profile-' + randomUUID(), name, role, bio: '', interests: []};
        const code = random();
        const accountId = random();
        await workspaces.insertOne({_id: accountId, recovery: recoveryDigest(code),
          snapshot: {member: userProfile.id, events: [], reports: [], userProfile}}, {session});
        await record('create', name, discoveryId(accountId));
        return result(201, {code});
      }
      if (!['archive', 'restore', 'publish', 'hide', 'resetCode'].includes(body?.action) || typeof body.id !== 'string') {
        return result(400, {error: 'Nieznana operacja.'});
      }
      const records = await workspaces.find({'snapshot.userProfile.id': {$exists: true}}, {projection: {'snapshot.userProfile': 1, archived: 1}, session}).toArray();
      const row = records.find(record => discoveryId(record._id) === body.id);
      if (!row) return result(404, {error: 'Nie znaleziono użytkownika.'});
      if (body.action === 'resetCode') {
        if (row.archived) return result(409, {error: 'Najpierw przywróć użytkownika.'});
        const code = random();
        await workspaces.updateOne({_id: row._id, archived: {$ne: true}}, {$set: {recovery: recoveryDigest(code)}, $unset: {demoLogin: ''}}, {session});
        await record('resetCode', row.snapshot.userProfile.name, body.id);
        return result(200, {code});
      }
      if (body.action === 'archive') {
        await workspaces.updateOne({_id: row._id}, {$set: {archived: true}}, {session});
        await profiles.deleteOne({_id: body.id}, {session});
      } else if (body.action === 'restore') {
        await workspaces.updateOne({_id: row._id}, {$unset: {archived: ''}}, {session});
      } else if (body.action === 'hide') {
        await profiles.deleteOne({_id: body.id}, {session});
      } else {
        if (row.archived) return result(409, {error: 'Najpierw przywróć użytkownika.'});
        await profiles.updateOne({_id: body.id}, {$set: discoveryFields(row.snapshot.userProfile)}, {upsert: true, session});
      }
      await record(body.action, row.snapshot.userProfile.name, body.id);
      return result(200, {ok: true});
    }));
    return send(res, response.status, response.payload);
  } catch (error) {
    if (error instanceof SyntaxError) return send(res, 400, {error: 'Nieprawidłowy formularz.'});
    console.error('CrewConnect user administration failed', error.code ?? error.name);
    return send(res, 503, {error: 'Panel jest chwilowo niedostępny.'});
  }
}
