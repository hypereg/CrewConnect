import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {CATEGORIES, DEFAULT_PLACES, isAccessPoint, withClimbingWall} from '../dist/ship-data.mjs';

const {MONGODB_URI, MONGODB_DATABASE = 'crewconnect', FRONTEND_ORIGIN, MAP_ADMIN_PASSWORD} = process.env;
const shipId = 'wonder-of-the-seas';
const seedVersion = 2;
const hash = value => createHash('sha256').update(value).digest();
const adminHash = MAP_ADMIN_PASSWORD ? hash(MAP_ADMIN_PASSWORD) : null;
const send = (res, status, body) => res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'}).end(JSON.stringify(body));
let connection;

function catalogCollection() {
  connection ??= new MongoClient(MONGODB_URI, {maxPoolSize: 5, serverSelectionTimeoutMS: 5000}).connect()
    .catch(error => {
      connection = undefined;
      throw error;
    });
  return connection.then(client => client.db(MONGODB_DATABASE).collection('shipMaps'));
}

async function readCatalog(collection) {
  const existing = await collection.findOne({_id: shipId});
  if (existing) {
    if (existing.seedVersion === seedVersion) return existing;
    const fields = {places: withClimbingWall(existing.places), revision: existing.revision + 1, seedVersion};
    const result = await collection.updateOne({_id: shipId, revision: existing.revision}, {$set: fields});
    return result.matchedCount ? {...existing, ...fields} : collection.findOne({_id: shipId});
  }
  try {
    await collection.updateOne({_id: shipId}, {$setOnInsert: {places: DEFAULT_PLACES, revision: 0, seedVersion}}, {upsert: true});
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  return collection.findOne({_id: shipId});
}

function publicCatalog({places, revision}) {
  return {places, revision, storage: 'database', editable: Boolean(adminHash)};
}

function isAdmin(req) {
  const token = req.headers.authorization?.match(/^Basic ([\w+/=]{1,4096})$/i)?.[1];
  if (!token || !adminHash) return false;
  const credentials = Buffer.from(token, 'base64').toString('utf8');
  return credentials.startsWith('map-admin:') && timingSafeEqual(hash(credentials.slice('map-admin:'.length)), adminHash);
}

async function readBody(req) {
  if (req.body !== undefined) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > 4096) throw new SyntaxError();
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new SyntaxError();
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function readPlace(place) {
  if (!isAccessPoint(place) || typeof place.category !== 'string' || !Object.hasOwn(CATEGORIES, place.category) ||
      typeof place.name !== 'string' || typeof place.description !== 'string') return null;
  const name = place.name.trim();
  const description = place.description.trim();
  if (!name || name.length > 64 || description.length > 180) return null;
  return {name, description, category: place.category, deck: place.deck, x: place.x, y: place.y};
}

export default async function places(req, res) {
  const allowed = FRONTEND_ORIGIN && req.headers.origin === FRONTEND_ORIGIN;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.writeHead(allowed ? 204 : 403).end();
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, {error: 'Niedozwolona metoda.'});
  try {
    if (req.method === 'GET') {
      if (!MONGODB_URI) return send(res, 200, {places: DEFAULT_PLACES, storage: 'demo', editable: false});
      return send(res, 200, publicCatalog(await readCatalog(await catalogCollection())));
    }
    if (!MONGODB_URI || !adminHash) return send(res, 503, {error: 'Zapis do bazy wymaga konfiguracji panelu.'});
    if (!isAdmin(req)) return send(res, 401, {error: 'Podaj poprawne hasło administratora mapy.'});
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
      return send(res, 415, {error: 'Wymagane dane JSON.'});
    }
    const data = await readBody(req);
    if (!data || !Number.isSafeInteger(data.revision) || !['save', 'delete'].includes(data.action) ||
        (data.id !== undefined && (typeof data.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(data.id)))) {
      return send(res, 400, {error: 'Sprawdź dane miejsca.'});
    }
    const place = data.action === 'save' ? readPlace(data.place) : null;
    if (data.action === 'save' && !place) return send(res, 400, {error: 'Podaj nazwę i wskaż wejście przy korytarzu.'});
    const collection = await catalogCollection();
    const catalog = await readCatalog(collection);
    if (data.revision !== catalog.revision) return send(res, 409, {error: 'Lista miejsc zmieniła się. Wczytaj ją ponownie.'});
    const index = catalog.places.findIndex(item => item.id === data.id);
    if ((data.id || data.action === 'delete') && index < 0) {
      return send(res, 404, {error: 'Tego miejsca nie ma już w katalogu.'});
    }
    if (index < 0 && catalog.places.length >= 100) return send(res, 400, {error: 'Katalog mieści do 100 miejsc.'});
    if (data.action === 'delete') {
      catalog.places.splice(index, 1);
    } else if (index < 0) {
      catalog.places.push({...place, id: randomUUID()});
    } else {
      const previous = catalog.places[index];
      catalog.places[index] = {...previous, ...place};
    }
    const revision = catalog.revision + 1;
    const result = await collection.updateOne({_id: shipId, revision: catalog.revision}, {$set: {places: catalog.places, revision}});
    if (!result.matchedCount) return send(res, 409, {error: 'Lista miejsc zmieniła się. Wczytaj ją ponownie.'});
    return send(res, 200, publicCatalog({places: catalog.places, revision}));
  } catch (error) {
    if (error instanceof SyntaxError) return send(res, 400, {error: 'Sprawdź format i rozmiar danych.'});
    console.error('CrewConnect ship map request failed', error.code ?? error.name);
    return send(res, 503, {error: 'Nie udało się połączyć z bazą miejsc.'});
  }
}
