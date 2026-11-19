import { createHash, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { validProfile } from './workspace.mjs';

const { MONGODB_URI, MONGODB_DATABASE = 'crewconnect' } = process.env;
let connecting;
function getDatabase() {
  if (!connecting) {
    connecting = new MongoClient(MONGODB_URI, {serverSelectionTimeoutMS: 5000}).connect()
      .catch(error => { connecting = undefined; throw error; });
  }
  return connecting.then(client => client.db(MONGODB_DATABASE));
}

const send = (res, status, data) => res.writeHead(status, {'Content-Type': 'application/json'}).end(JSON.stringify(data));
const publicId = session => createHash('sha256').update('crewconnect-discovery:' + session).digest('hex');
const validId = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
const pair = (first, second) => [first, second].sort().join(':');

async function readBody(req) {
  if (req.body !== undefined) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new SyntaxError();
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export default async function connections(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const session = req.headers.cookie?.match(/(?:^|; *)crew_workspace=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!session) return send(res, 401, {error: 'Odśwież stronę, aby wznowić sesję.'});
  const me = publicId(session);
  try {
    const db = await getDatabase();
    const profiles = db.collection('discovery_profiles');
    const matches = db.collection('discovery_matches');
    if (req.method === 'GET') {
      const peer = new URL(req.url, 'http://localhost').searchParams.get('peer');
      if (peer !== null) {
        if (!validId(peer) || peer === me) return send(res, 400, {error: 'Nieprawidłowa rozmowa.'});
        const match = await matches.findOne({_id: pair(me, peer), likes: {$all: [me, peer]}});
        if (!match) return send(res, 403, {error: 'Rozmowa wymaga obustronnego dopasowania.'});
        return send(res, 200, {messages: match.messages ?? []});
      }
      const own = await profiles.findOne({_id: me});
      if (!own) return send(res, 200, {published: false, profiles: [], liked: [], matches: []});
      const [others, choices] = await Promise.all([
        profiles.find({_id: {$ne: me}}).sort({_id: 1}).toArray(),
        matches.find({likes: me}, {projection: {likes: 1, members: 1}}).toArray()
      ]);
      const liked = choices.map(item => item.members.find(id => id !== me));
      const matched = choices.filter(item => item.likes.length === 2).map(item => item.members.find(id => id !== me));
      return send(res, 200, {me, published: true, profiles: others.map(({_id, ...profile}) => ({...profile, id: _id})), liked, matches: matched});
    }
    if (req.method !== 'POST') return send(res, 405, {error: 'Niedozwolona metoda.'});
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res, 415, {error: 'Wymagany JSON.'});
    const body = await readBody(req);
    if (body?.action === 'publish') {
      if (!validProfile(body.profile) || !['', 'women', 'men'].includes(body.profile.gender)) {
        return send(res, 400, {error: 'Uzupełnij dane profilu.'});
      }
      const {name, role, bio, interests, intent, icebreaker, gender} = body.profile;
      await profiles.updateOne({_id: me}, {$set: {name, role, bio, interests, intent: intent ?? '', icebreaker: icebreaker ?? '', gender}}, {upsert: true});
      return send(res, 200, {ok: true});
    }
    if (body?.action === 'hide') {
      await profiles.deleteOne({_id: me});
      return send(res, 200, {ok: true});
    }
    if (body?.action === 'resetMatches') {
      await matches.updateMany({likes: me}, {$pull: {likes: me}});
      return send(res, 200, {ok: true});
    }
    const peer = body?.peer;
    if (!validId(peer) || peer === me) return send(res, 400, {error: 'Nieprawidłowy profil.'});
    const id = pair(me, peer);
    if (body.action === 'like') {
      if (await profiles.countDocuments({_id: {$in: [me, peer]}}) !== 2) {
        return send(res, 404, {error: 'Profil online jest niedostępny.'});
      }
      await matches.updateOne({_id: id}, {$setOnInsert: {members: [me, peer]}, $addToSet: {likes: me}}, {upsert: true});
      return send(res, 200, {ok: true});
    }
    if (body.action === 'message') {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > 500) return send(res, 400, {error: 'Wpisz wiadomość do 500 znaków.'});
      const result = await matches.updateOne({_id: id, likes: {$all: [me, peer]}},
        {$push: {messages: {$each: [{id: randomUUID(), sender: me, text, at: new Date()}], $slice: -100}}});
      if (!result.matchedCount) return send(res, 403, {error: 'Rozmowa wymaga obustronnego dopasowania.'});
      return send(res, 200, {ok: true});
    }
    return send(res, 400, {error: 'Nieznana operacja.'});
  } catch (error) {
    if (error instanceof SyntaxError) return send(res, 400, {error: 'Nieprawidłowe dane.'});
    console.error('CrewConnect connections request failed', error.code ?? error.name);
    return send(res, 503, {error: 'Usługa dopasowań jest chwilowo niedostępna.'});
  }
}
