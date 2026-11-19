import { MongoClient } from 'mongodb';

const { MONGODB_URI, MONGODB_DATABASE = 'crewconnect' } = process.env;
let connection;
function eventsCollection() {
  if (!connection) {
    connection = new MongoClient(MONGODB_URI, {serverSelectionTimeoutMS: 5000}).connect()
      .catch(error => { connection = undefined; throw error; });
  }
  return connection.then(client => client.db(MONGODB_DATABASE).collection('events'));
}

const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 100 &&
  !['__proto__', 'constructor', 'prototype'].includes(name) && !/[.$\u0000]/u.test(name);
const validVote = (vote, slots) => Array.isArray(vote) && vote.length > 0 && vote.length <= slots.length &&
  vote.every(index => Number.isInteger(index) && index >= 0 && index < slots.length);
const send = (res, status, body) => res.writeHead(status, {'Content-Type': 'application/json'}).end(JSON.stringify(body));

async function readBody(req) {
  if (req.body !== undefined) return req.body;
  let input = '';
  for await (const chunk of req) {
    input += chunk;
    if (input.length > 16_384) throw new SyntaxError('Request too large.');
  }
  return JSON.parse(input);
}

export default async function events(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const collection = await eventsCollection();
      const entries = await collection.find({}, {projection: {_id: 0, revision: 0}})
        .sort({createdAt: -1}).limit(200).toArray();
      return send(res, 200, entries);
    }
    if (req.method !== 'POST') return send(res, 405, {error: 'Niedozwolona metoda.'});
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res, 415, {error: 'Wymagany JSON.'});
    const body = await readBody(req);
    const id = body?.id;
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return send(res, 400, {error: 'Nieprawidłowe wydarzenie.'});
    if (body.action === 'publish') {
      const {title, description, owner, type, slots, capacity, votes} = body;
      if (typeof title !== 'string' || !title.trim() || title.length > 90 ||
          typeof description !== 'string' || description.length > 500 || !validName(owner) ||
          !['Gry', 'Trening', 'Integracja', 'Inne'].includes(type) ||
          !Number.isInteger(capacity) || capacity < 2 || capacity > 30 ||
          !Array.isArray(slots) || slots.length < 2 || slots.length > 3 || new Set(slots).size !== slots.length ||
          !slots.every(slot => typeof slot === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(slot) && Number.isFinite(Date.parse(slot))) ||
          !validVote(votes?.[owner], slots)) return send(res, 400, {error: 'Sprawdź dane wydarzenia.'});
      const collection = await eventsCollection();
      await collection.updateOne({_id: id}, {$setOnInsert: {
        id, title, description, owner, type, slots, capacity, votes: {[owner]: votes[owner]},
        revision: 0, createdAt: new Date()
      }}, {upsert: true});
      return send(res, 200, {ok: true});
    }
    if (body.action !== 'vote' || !validName(body.member)) return send(res, 400, {error: 'Nieprawidłowy zapis.'});
    const collection = await eventsCollection();
    const event = await collection.findOne({_id: id});
    if (!event) return send(res, 404, {error: 'Nie znaleziono wydarzenia.'});
    const {member, vote} = body;
    if (vote === null ? member === event.owner : !validVote(vote, event.slots)) return send(res, 400, {error: 'Nieprawidłowa dostępność.'});
    if (vote && !Object.hasOwn(event.votes, member) && Object.keys(event.votes).length >= event.capacity) {
      return send(res, 409, {error: 'Brak wolnych miejsc.'});
    }
    if (vote === null) delete event.votes[member];
    else event.votes[member] = vote;
    const result = await collection.updateOne({_id: id, revision: event.revision},
      {$set: {votes: event.votes}, $inc: {revision: 1}});
    if (!result.matchedCount) return send(res, 409, {error: 'Lista zapisów się zmieniła. Spróbuj ponownie.'});
    return send(res, 200, {ok: true});
  } catch (error) {
    if (error instanceof SyntaxError) return send(res, 400, {error: 'Nieprawidłowe dane.'});
    console.error('CrewConnect events request failed', error.code ?? error.name);
    return send(res, 503, {error: 'Brak połączenia z bazą wydarzeń.'});
  }
}
