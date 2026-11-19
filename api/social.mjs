import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import qrFactory from 'qrcode-generator';
import { createSocialStore } from '../social-store.mjs';

const env = process.env;
const hosted = env.NODE_ENV === 'production' || Boolean(env.VERCEL);
const mongoUri = env.SOCIAL_MONGODB_URI || env.MONGODB_URI;
const dbName = env.SOCIAL_MONGODB_DATABASE || (env.MONGODB_DATABASE || 'crewconnect') + '_social_demo';
const adminEmail = (env.DEMO_ADMIN_EMAIL || 'admin@example.test').trim().toLowerCase();
const adminCode = env.DEMO_ADMIN_CODE || (hosted ? '' : 'crew-admin-demo');
const secret = env.DEMO_SESSION_SECRET || randomBytes(32);
const guestCode = '123456';
const cookieName = 'crew_social_session';
const ttl = 7 * 86400;
const categories = ['Gry', 'Trening', 'Integracja', 'Inne'];
const admin = {id: 'admin', email: adminEmail, name: 'Administrator', role: 'admin', active: true};
const store = createSocialStore(mongoUri, dbName);

function fail(status, message) {
  throw Object.assign(new Error(message), {status});
}

function text(value, limit, label, required = true) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (clean.length > limit || (required && !clean)) fail(400, 'Sprawdź pole „' + label + '”.');
  return clean;
}

function number(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) fail(400, 'Sprawdź pole „' + label + '”.');
  return value;
}

function email(value) {
  const clean = text(value, 120, 'E-mail').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) fail(400, 'Wpisz poprawny adres e-mail.');
  return clean;
}

function digest(value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function session(req, state) {
  const cookie = req.headers.cookie?.split(/;\s*/).find(item => item.startsWith(cookieName + '='));
  const [id, expiry, version, signature] = cookie?.slice(cookieName.length + 1).split('.') || [];
  if (!(Number(expiry) > Date.now()) || !equal(signature, digest(id + '.' + expiry + '.' + version))) return null;
  const account = id === admin.id ? admin : state.accounts.find(item => item.id === id);
  return account?.active && Number(version) === (account.sessionVersion ?? 0) ? account : null;
}

function setSession(res, account) {
  const value = account ? account.id + '.' + (Date.now() + ttl * 1000) + '.' + (account.sessionVersion ?? 0) : '';
  res.setHeader('Set-Cookie', cookieName + '=' + (value ? value + '.' + digest(value) : '') +
    '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + (account ? ttl : 0) + (hosted ? '; Secure' : ''));
}

function listed(array, id, message) {
  const item = array.find(entry => entry.id === id);
  if (!item) fail(404, message);
  return item;
}

const activeVoyage = state => state.voyages.find(item => item.active);
const membership = (user, voyage) => user?.memberships?.find(item => item.voyageId === voyage?.id);
const cabinOf = (state, member) => state.cabins.find(item => item.id === member?.cabinId);
const peopleIn = (state, cabin) => state.accounts.filter(person =>
  person.memberships?.some(item => item.cabinId === cabin.id)).length;
const staff = user => user.role !== 'guest';
const manages = (user, event) => user.role === 'admin' || (user.role === 'planner' && event.ownerId === user.id);

function chatPartner(state, user, voyage, id) {
  const person = state.accounts.find(item => item.id === id);
  const connected = (from, to) => state.choices.some(choice =>
    choice.voyageId === voyage?.id && choice.from === from && choice.to === to && choice.choice === 'connect');
  if (!voyage || !user?.visible || !person?.active || !person.visible ||
      user.id === id || !membership(user, voyage) || !membership(person, voyage) ||
      !connected(user.id, id) || !connected(id, user.id)) fail(404, 'Czat jest niedostępny.');
  return person;
}

function readChat(state, user, voyage, id) {
  const person = chatPartner(state, user, voyage, id);
  return {person: publicProfile(person), messages: (state.messages || []).filter(item => item.voyageId === voyage.id &&
    ((item.from === user.id && item.to === id) || (item.from === id && item.to === user.id))).slice(-100)};
}

function invitation(state, token, checkCapacity = true) {
  if (typeof token !== 'string' || !/^[\w-]{32}$/.test(token)) fail(404, 'Zaproszenie jest nieprawidłowe lub wygasło.');
  const voyage = activeVoyage(state);
  const cabin = state.cabins.find(item => item.voyageId === voyage?.id && item.code === digest('qr:' + token));
  if (!cabin) fail(404, 'Zaproszenie jest nieprawidłowe lub wygasło.');
  if (checkCapacity && peopleIn(state, cabin) >= cabin.capacity) fail(409, 'Wykorzystano wszystkie miejsca w tej kabinie.');
  return {voyage, cabin};
}

function publicProfile(person) {
  const {id, name, bio = '', interests = []} = person;
  return {id, name, bio, interests};
}

function board(state, user) {
  if (!user) return {user: null};
  const voyage = activeVoyage(state);
  const member = membership(user, voyage);
  const access = staff(user) || Boolean(member);
  const choices = access ? state.choices.filter(item => item.voyageId === voyage?.id) : [];
  const matches = new Set(choices.filter(item => item.to === user.id && item.choice === 'connect').map(item => item.from));
  const ownChoices = new Map(choices.filter(item => item.from === user.id).map(item => [item.to, item.choice]));
  const profiles = user.visible && access ? state.accounts.filter(person =>
    person.id !== user.id && person.role === 'guest' && person.active && person.visible && membership(person, voyage))
    .map(person => ({...publicProfile(person), choice: ownChoices.get(person.id), match: matches.has(person.id) && ownChoices.get(person.id) === 'connect'})) : [];
  const events = access ? state.events.filter(event =>
    (event.voyageId === voyage?.id || user.role === 'admin') &&
    (manages(user, event) || event.status === 'published' ||
      (event.status === 'cancelled' && event.attendees.includes(user.id)))) : [];
  return {
    user: {...publicProfile(user), role: user.role, visible: Boolean(user.visible), cabin: cabinOf(state, member)?.label},
    voyage: access ? voyage || null : null,
    access,
    profiles,
    events: events.map(({attendees, ...event}) => {
      const canManage = manages(user, event);
      return {...event, canManage, count: attendees.length, joined: attendees.includes(user.id),
        ...(canManage && {attendees: attendees.map(id => id === admin.id ? admin.name :
          state.accounts.find(person => person.id === id)?.name || 'Uczestnik')})};
    }),
    ...(user.role === 'admin' && {
      voyages: state.voyages,
      cabins: state.cabins.map(({code, ...cabin}) => ({...cabin, hasCode: Boolean(code), used: peopleIn(state, cabin)})),
      planners: state.accounts.filter(person => person.role === 'planner')
        .map(({id, name, email, active}) => ({id, name, email, active}))
    })
  };
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23', hour: '2-digit', minute: '2-digit'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
}

function parseTime(value, timeZone) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) fail(400, 'Podaj datę i godzinę.');
  const target = Date.parse(value + 'Z');
  if (!Number.isFinite(target)) fail(400, 'Podaj poprawny termin.');
  let time = target;
  for (let step = 0; step < 4; step++) {
    const local = localParts(new Date(time), timeZone);
    if (local === value) return new Date(time).toISOString();
    time += target - Date.parse(local + 'Z');
  }
  fail(400, 'Ta godzina nie występuje w strefie czasowej rejsu.');
}

function login(state, body) {
  const address = email(body.email);
  const user = address === admin.email ? admin : state.accounts.find(item => item.email === address);
  const valid = user?.role === 'admin' ? equal(body.code, adminCode) :
    user?.role === 'planner' ? equal(digest('planner:' + text(body.code, 100, 'Kod')), user.code) : equal(body.code, guestCode);
  if (!user?.active || !valid) fail(401, 'Sprawdź adres e-mail i kod.');
  return user.id;
}

function register(state, body) {
  const address = email(body.email);
  const name = text(body.name, 60, 'Nazwa wyświetlana');
  if (!equal(body.code, guestCode)) fail(400, 'Wpisz kod demo 123456.');
  const {voyage, cabin} = invitation(state, body.token, false);
  let user = state.accounts.find(person => person.email === address);
  if (address === admin.email || (user && user.role !== 'guest')) fail(409, 'Użyj innego testowego adresu e-mail.');
  const current = membership(user, voyage);
  if (current?.cabinId === cabin.id) return user.id;
  if (current) fail(409, 'To konto jest przypisane do innej kabiny.');
  if (peopleIn(state, cabin) >= cabin.capacity) fail(409, 'Wykorzystano wszystkie miejsca w tej kabinie.');
  if (!user) {
    user = {id: randomUUID(), email: address, name, role: 'guest', active: true, memberships: []};
    state.accounts.push(user);
  }
  user.memberships.push({voyageId: voyage.id, cabinId: cabin.id});
  return user.id;
}

function adminAction(state, body, voyage, origin) {
  switch (body.action) {
    case 'createVoyage': {
      if (voyage) fail(409, 'Najpierw zakończ aktywny rejs.');
      const timeZone = text(body.timeZone, 80, 'Strefa czasowa');
      try { new Intl.DateTimeFormat('pl', {timeZone}); } catch { fail(400, 'Podaj strefę, np. Europe/Warsaw.'); }
      state.voyages.push({id: randomUUID(), name: text(body.name, 80, 'Nazwa rejsu'), timeZone, active: true});
      return {};
    }
    case 'closeVoyage':
      if (!voyage || voyage.id !== body.id) fail(409, 'Ten rejs został już zakończony.');
      voyage.active = false;
      voyage.closedAt = new Date().toISOString();
      return {};
    case 'addCabin': {
      if (!voyage || voyage.id !== body.voyageId) fail(409, 'Odśwież aktywny rejs.');
      const label = text(body.label, 24, 'Numer kabiny');
      if (state.cabins.some(item => item.voyageId === voyage.id && item.label.toLowerCase() === label.toLowerCase())) {
        fail(409, 'Ta kabina już istnieje w tym rejsie.');
      }
      state.cabins.push({id: randomUUID(), voyageId: voyage.id, label, capacity: number(body.capacity, 1, 20, 'Liczba gości')});
      return {};
    }
    case 'issueQr':
    case 'revokeQr': {
      const cabin = listed(state.cabins, body.id, 'Nie znaleziono kabiny.');
      if (voyage?.id !== cabin.voyageId) fail(409, 'Ten rejs został zakończony.');
      if (body.action === 'revokeQr') {
        delete cabin.code;
        return {};
      }
      const token = randomBytes(24).toString('base64url');
      cabin.code = digest('qr:' + token);
      const url = new URL('/#rejestracja?kod=' + token, origin).href;
      const qr = qrFactory(0, 'M');
      qr.addData(url);
      qr.make();
      return {print: {url, image: qr.createDataURL(6), cabin: cabin.label, voyage: voyage.name}};
    }
    case 'createPlanner': {
      const address = email(body.email);
      if (address === admin.email || state.accounts.some(item => item.email === address)) fail(409, 'To konto już istnieje.');
      const code = randomBytes(9).toString('base64url');
      state.accounts.push({id: randomUUID(), email: address, name: text(body.name, 60, 'Nazwa plannera'),
        role: 'planner', active: true, code: digest('planner:' + code)});
      return {plannerCode: code, plannerEmail: address};
    }
    case 'togglePlanner': {
      const planner = listed(state.accounts.filter(item => item.role === 'planner'), body.id, 'Nie znaleziono plannera.');
      planner.active = body.active === true;
      if (!planner.active) planner.sessionVersion = (planner.sessionVersion ?? 0) + 1;
      return {};
    }
    case 'resetPlannerCode': {
      const planner = listed(state.accounts.filter(item => item.role === 'planner'), body.id, 'Nie znaleziono plannera.');
      const code = randomBytes(9).toString('base64url');
      planner.code = digest('planner:' + code);
      planner.sessionVersion = (planner.sessionVersion ?? 0) + 1;
      return {plannerCode: code, plannerEmail: planner.email};
    }
    default: fail(400, 'Nieznana operacja.');
  }
}

function saveEvent(state, body, user, voyage) {
  if (!staff(user)) fail(403, 'Publikowanie jest dostępne dla plannera i admina.');
  const event = body.id ? listed(state.events, body.id, 'Nie znaleziono wydarzenia.') : null;
  if (event && !manages(user, event)) fail(403, 'Możesz zarządzać własnymi wydarzeniami.');
  if (event && (event.voyageId !== voyage.id || event.status === 'cancelled')) fail(409, 'Wydarzenie jest zamknięte.');
  if (event && body.revision !== event.revision) fail(409, 'Wydarzenie zostało zmienione. Otwórz aktualną wersję.');
  if (event?.status === 'published' && body.publish !== true) fail(409, 'To wydarzenie jest już opublikowane.');
  if (!categories.includes(body.category)) fail(400, 'Wybierz kategorię.');
  const startsAt = parseTime(body.localTime, voyage.timeZone);
  if (Date.parse(startsAt) <= Date.now()) fail(400, 'Wybierz termin w przyszłości.');
  const capacity = body.capacity === null ? null : number(body.capacity, 1, 500, 'Limit miejsc');
  if (capacity !== null && event && capacity < event.attendees.length) fail(409, 'Limit jest mniejszy od liczby zapisów.');
  const title = text(body.title, 90, 'Nazwa wydarzenia');
  const place = text(body.place, 100, 'Miejsce');
  const description = text(body.description, 500, 'Opis', false);
  const status = body.publish === true ? 'published' : 'draft';
  const changes = event?.status === 'published' ? [
    ...(event.startsAt !== startsAt ? ['termin'] : []),
    ...(event.place !== place ? ['miejsce'] : [])
  ] : [];
  const updated = {title, place, description, category: body.category, startsAt, localTime: body.localTime,
    capacity, status, revision: (event?.revision ?? 0) + 1, changes: changes.length ? changes : event?.changes || []};
  if (event) Object.assign(event, updated);
  else state.events.push({...updated, id: randomUUID(), ownerId: user.id, owner: user.name, voyageId: voyage.id, attendees: []});
  return {};
}

function memberAction(state, body, user, voyage) {
  switch (body.action) {
    case 'saveEvent': return saveEvent(state, body, user, voyage);
    case 'cancelEvent': {
      const event = listed(state.events, body.id, 'Nie znaleziono wydarzenia.');
      if (!manages(user, event)) fail(403, 'Możesz zarządzać własnymi wydarzeniami.');
      if (event.voyageId !== voyage.id || event.status === 'draft') fail(409, 'Wydarzenie jest zamknięte.');
      if (event.status !== 'cancelled') {
        event.status = 'cancelled';
        event.revision++;
      }
      return {};
    }
    case 'join':
    case 'leave': {
      const event = listed(state.events, body.id, 'Nie znaleziono wydarzenia.');
      if (event.voyageId !== voyage.id || event.status !== 'published') fail(404, 'Wydarzenie jest niedostępne.');
      if (Date.parse(event.startsAt) <= Date.now()) fail(409, 'Wydarzenie już się rozpoczęło.');
      if (body.action === 'leave') event.attendees = event.attendees.filter(id => id !== user.id);
      else if (!event.attendees.includes(user.id)) {
        if (event.capacity !== null && event.attendees.length >= event.capacity) fail(409, 'Wszystkie miejsca są już zajęte.');
        event.attendees.push(user.id);
      }
      return {};
    }
    case 'profile': {
      if (user.id === admin.id) fail(403, 'Profil administratora jest ustawiony w konfiguracji.');
      user.name = text(body.name, 60, 'Nazwa wyświetlana');
      user.bio = text(body.bio, 240, 'O mnie', false);
      user.interests = text(body.interests, 160, 'Zainteresowania', false).split(',').map(item => item.trim()).filter(Boolean);
      user.visible = user.role === 'guest' && body.visible === true;
      return {};
    }
    case 'resetMatches': {
      if (user.role !== 'guest') fail(403, 'Ta operacja jest dostępna dla gości rejsu.');
      state.choices = state.choices.filter(choice => choice.from !== user.id);
      return {};
    }
    case 'choose': {
      const person = state.accounts.find(item => item.id === body.id);
      if (!user.visible || !person?.visible || !person.active || person.id === user.id || !membership(person, voyage)) {
        fail(404, 'Ten profil jest niedostępny.');
      }
      if (!['connect', 'skip'].includes(body.choice)) fail(400, 'Nieprawidłowy wybór.');
      const existing = state.choices.find(item => item.voyageId === voyage.id && item.from === user.id && item.to === person.id);
      if (existing) existing.choice = body.choice;
      else state.choices.push({voyageId: voyage.id, from: user.id, to: person.id, choice: body.choice});
      return {};
    }
    case 'sendMessage': {
      const person = chatPartner(state, user, voyage, body.id);
      state.messages ||= [];
      state.messages.push({id: randomUUID(), voyageId: voyage.id, from: user.id, to: person.id,
        text: text(body.message, 500, 'Wiadomość'), at: new Date().toISOString()});
      return {};
    }
    default: fail(400, 'Nieznana operacja.');
  }
}

const adminActions = new Set(['createVoyage', 'closeVoyage', 'addCabin', 'issueQr', 'revokeQr',
  'createPlanner', 'togglePlanner', 'resetPlannerCode']);

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let input = '';
  for await (const chunk of req) {
    input += chunk;
    if (input.length > 8192) fail(413, 'Dane formularza są za duże.');
  }
  return JSON.parse(input);
}

export default async function social(req, res) {
  const send = (status, value) => res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'}).end(JSON.stringify(value));
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (dbName === (env.MONGODB_DATABASE || 'crewconnect') || (hosted &&
        (!mongoUri || !env.DEMO_SESSION_SECRET || env.DEMO_SESSION_SECRET.length < 32 || adminCode.length < 12 || !env.DEMO_ADMIN_EMAIL))) {
      return send(503, {error: 'Wspólne demo wymaga konfiguracji serwera.', code: 'DEMO_NOT_CONFIGURED'});
    }
    if (req.method === 'GET') {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const token = params.get('invite');
      const chat = params.get('chat');
      const state = await store.read();
      if (token !== null) {
        const {cabin, voyage} = invitation(state, token, false);
        return send(200, {cabin: cabin.label, voyage: voyage.name, full: peopleIn(state, cabin) >= cabin.capacity});
      }
      const user = session(req, state);
      if (chat !== null) return send(200, readChat(state, user, activeVoyage(state), chat));
      return send(200, board(state, user));
    }
    if (req.method !== 'POST') fail(405, 'Niedozwolona metoda.');
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail(415, 'Wymagany JSON.');
    const origin = new URL(req.headers.origin || 'http://' + req.headers.host);
    if (origin.host !== req.headers.host || !['https:', 'http:'].includes(origin.protocol) ||
        req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Niedozwolone źródło żądania.');
    const body = await readBody(req);
    if (body?.action === 'logout') {
      setSession(res, null);
      return send(200, {user: null});
    }
    if (body?.action === 'login' || body?.action === 'register') {
      const id = body.action === 'login' ? login(await store.read(), body) : await store.change(state => register(state, body));
      const state = await store.read();
      const account = id === admin.id ? admin : state.accounts.find(item => item.id === id && item.active);
      setSession(res, account);
      return send(200, board(state, account));
    }
    const result = await store.change(state => {
      const user = session(req, state);
      if (!user) fail(401, 'Zaloguj się ponownie.');
      const voyage = activeVoyage(state);
      if (adminActions.has(body?.action)) {
        if (user.role !== 'admin') fail(403, 'Ta operacja wymaga konta admina.');
        return adminAction(state, body, voyage, origin.origin);
      }
      if (!voyage || (!staff(user) && !membership(user, voyage))) fail(403, 'Dołącz do aktywnego rejsu.');
      return memberAction(state, body || {}, user, voyage);
    });
    const state = await store.read();
    return send(200, {...board(state, session(req, state)), ...result});
  } catch (error) {
    if (!error.status && !(error instanceof SyntaxError)) console.error('Social demo:', error.code ?? error.name);
    return send(error.status || (error instanceof SyntaxError ? 400 : 503), {
      error: error.status ? error.message : error instanceof SyntaxError ? 'Nieprawidłowe dane.' : 'Serwer demo jest chwilowo niedostępny.'
    });
  }
}
