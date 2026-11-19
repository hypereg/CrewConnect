import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { validProfile } from './workspace.mjs';
import { discoveryId, discoveryFields } from '../discovery-profile.mjs';

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
  const me = discoveryId(session);
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
        return send(res, 200, {
          messages: match.messages ?? [],
          peerTyping: Number(match.typingUntil?.[peer] ?? 0) > Date.now()
        });
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
      await profiles.updateOne({_id: me}, {$set: discoveryFields(body.profile)}, {upsert: true});
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
      await matches.updateOne({_id: id}, {$setOnInsert: {members: [me, peer]}, $addToSet: {likes: me}}, {upsert: true})
        .catch(error => {
          if (error.code !== 11000) throw error;
          return matches.updateOne({_id: id}, {$addToSet: {likes: me}});
        });
      return send(res, 200, {ok: true});
    }
    const thread = {_id: id, likes: {$all: [me, peer]}};
    const typingKey = 'typingUntil.' + me;
    if (body.action === 'typing' && typeof body.active === 'boolean') {
      const result = await matches.updateOne(thread, body.active ?
        {$set: {[typingKey]: new Date(Date.now() + 6500)}} : {$unset: {[typingKey]: ''}});
      return result.matchedCount ? send(res, 200, {ok: true}) :
        send(res, 403, {error: 'Rozmowa wymaga obustronnego dopasowania.'});
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (body.action === 'message' || body.action === 'editMessage') {
      if (!text || text.length > 500) return send(res, 400, {error: 'Wpisz wiadomość do 500 znaków.'});
    }
    if (body.action === 'message') {
      const result = await matches.updateOne(thread,
        {$push: {messages: {$each: [{id: randomUUID(), sender: me, text, at: new Date()}], $slice: -100}},
          $unset: {[typingKey]: ''}});
      if (!result.matchedCount) return send(res, 403, {error: 'Rozmowa wymaga obustronnego dopasowania.'});
      return send(res, 200, {ok: true});
    }
    if (body.action === 'editMessage' || body.action === 'deleteMessage') {
      if (typeof body.messageId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.messageId)) {
        return send(res, 400, {error: 'Nieprawidłowa wiadomość.'});
      }
      const target = {id: body.messageId, sender: me, deletedAt: {$exists: false}};
      const update = body.action === 'editMessage' ?
        {$set: {'messages.$.text': text, 'messages.$.editedAt': new Date()}, $unset: {[typingKey]: ''}} :
        {$set: {'messages.$.deletedAt': new Date()}, $unset: {'messages.$.text': '', [typingKey]: ''}};
      const result = await matches.updateOne({...thread, messages: {$elemMatch: target}}, update);
      return result.matchedCount ? send(res, 200, {ok: true}) :
        send(res, 404, {error: 'Możesz zmieniać tylko własne, nieusunięte wiadomości.'});
    }
    return send(res, 400, {error: 'Nieznana operacja.'});
  } catch (error) {
    if (error instanceof SyntaxError) return send(res, 400, {error: 'Nieprawidłowe dane.'});
    console.error('CrewConnect connections request failed', error.code ?? error.name);
    return send(res, 503, {error: 'Usługa dopasowań jest chwilowo niedostępna.'});
  }
}
