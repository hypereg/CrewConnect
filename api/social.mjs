import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import qrFactory from 'qrcode-generator';
import { createSocialStore } from '../social-store.mjs';
import { sharedPlaces } from './places.mjs';
import { crewAdminDigest, matchesCrewAdminKey } from './users.mjs';

const env = process.env;
const hosted = env.NODE_ENV === 'production' || Boolean(env.VERCEL);
const mongoUri = env.SOCIAL_MONGODB_URI || env.MONGODB_URI;
const dbName = env.SOCIAL_MONGODB_DATABASE || (env.MONGODB_DATABASE || 'crewconnect') + '_social_demo';
const adminEmail = (env.DEMO_ADMIN_EMAIL || 'admin@example.test').trim().toLowerCase();
const adminCode = env.DEMO_ADMIN_CODE || (hosted ? '' : '12345');
const configuredAdmin = !hosted || (Boolean(env.DEMO_ADMIN_EMAIL?.trim()) && adminCode.length >= 12);
let secret = hosted ? (env.DEMO_SESSION_SECRET?.length >= 32 ? env.DEMO_SESSION_SECRET : null) :
  env.DEMO_SESSION_SECRET || randomBytes(32);
const cookieName = 'crew_social_session';
const loginCookieName = 'crew_social_login';
const loginCodeSeconds = 600;
const demoCabinCode = '123456';
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

function readCookie(req, name) {
  return req.headers.cookie?.split(/;\s*/).find(item => item.startsWith(name + '='))?.slice(name.length + 1);
}

function session(req, state) {
  const [id, expiry, version, signature] = readCookie(req, cookieName)?.split('.') || [];
  if (!(Number(expiry) > Date.now()) || !equal(signature, digest(id + '.' + expiry + '.' + version))) return null;
  const account = id === admin.id ? admin : state.accounts.find(item => item.id === id);
  return account?.active && Number(version) === (account.sessionVersion ?? 0) ? account : null;
}

function setSession(res, account) {
  const value = account ? account.id + '.' + (Date.now() + ttl * 1000) + '.' + (account.sessionVersion ?? 0) : '';
  res.setHeader('Set-Cookie', [
    cookie(cookieName, value ? value + '.' + digest(value) : '', '/', ttl),
    cookie(loginCookieName, '', '/api/social', loginCodeSeconds)
  ]);
}

function cookie(name, value, path, maxAge) {
  return name + '=' + value + '; Path=' + path + '; HttpOnly; SameSite=Strict; Max-Age=' +
    (value ? maxAge : 0) + (hosted ? '; Secure' : '');
}

function loginBrowser(req) {
  const token = readCookie(req, loginCookieName);
  return /^[A-Za-z0-9_-]{32}$/.test(token || '') ? token : null;
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
const manages = (user, event) => user.role === 'admin' || event.ownerId === user.id;
const hasStarted = event => Date.parse(event.startsAt) <= Date.now();

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
  const {id, name, age = null, roleOnShip = '', bio = '', interests = []} = person;
  return {id, name, age, roleOnShip, bio, interests};
}

function cabinLabels(value) {
  const input = text(value, 4096, 'Numery kabin');
  const labels = [];
  const seen = new Set();
  function add(label) {
    const key = label.toLowerCase();
    if (seen.has(key)) fail(400, 'Powtórzony numer kabiny: ' + label + '.');
    if (labels.length === 200) fail(400, 'W jednej partii możesz dodać maksymalnie 200 kabin.');
    labels.push(text(label, 24, 'Numer kabiny'));
    seen.add(key);
  }
  for (const item of input.split(/[\n,;]+/).map(part => part.trim()).filter(Boolean)) {
    const range = /^(\d{1,8})\s*[-–]\s*(\d{1,8})$/.exec(item);
    if (!range) { add(item); continue; }
    const [, first, last] = range;
    const start = Number(first), end = Number(last);
    if (end < start) fail(400, 'Podaj rosnący zakres kabin: ' + item + '.');
    if (end - start + 1 > 200 - labels.length) fail(400, 'W jednej partii możesz dodać maksymalnie 200 kabin.');
    const width = /^0\d/.test(first) || /^0\d/.test(last) ? Math.max(first.length, last.length) : 0;
    for (let n = start; n <= end; n++) add(String(n).padStart(width, '0'));
  }
  if (!labels.length) fail(400, 'Wpisz co najmniej jeden numer kabiny.');
  return labels;
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
      return {...event, source: event.source ?? 'program', canManage, count: attendees.length, joined: attendees.includes(user.id),
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

function accountByEmail(state, address) {
  return address === admin.email ? admin : state.accounts.find(item => item.email === address);
}

function issueGuestCode(state, address, browser, code) {
  const user = accountByEmail(state, address);
  if (user?.role !== 'guest' || !user.active) fail(404, 'Nie znaleziono konta gościa z tym adresem e-mail.');
  const now = Date.now();
  const pending = (user.loginCodes || []).filter(item => item.expiresAt > now && item.browser !== browser);
  user.loginCodes = [...pending.slice(-4), {
    browser, code: digest('guest-code:' + browser + ':' + code), expiresAt: now + loginCodeSeconds * 1000, attempts: 5
  }];
}

function verifyGuestCode(state, address, browser, code) {
  const user = accountByEmail(state, address);
  if (user?.role !== 'guest' || !user.active) return null;
  const challenge = user.loginCodes?.find(item => item.browser === browser);
  if (!challenge || challenge.expiresAt <= Date.now() || challenge.attempts < 1) return null;
  if (!equal(challenge.code, digest('guest-code:' + browser + ':' + code))) {
    challenge.attempts--;
    return null;
  }
  user.loginCodes = user.loginCodes.filter(item => item !== challenge);
  return user.id;
}

async function login(req, state, body, existingAdminDigest) {
  const address = email(body.email);
  const user = accountByEmail(state, address);
  if (user?.active && user.role === 'admin' && (configuredAdmin ? equal(body.code, adminCode) :
    matchesCrewAdminKey(body.code, existingAdminDigest))) return user.id;
  if (user?.active && user.role === 'planner' &&
      equal(digest('planner:' + text(body.code, 100, 'Kod')), user.code)) return user.id;
  const token = loginBrowser(req);
  if (user?.active && user.role === 'guest' && token && typeof body.code === 'string' && /^\d{6}$/.test(body.code)) {
    const id = await store.change(current => verifyGuestCode(current, address, digest('guest-browser:' + token), body.code));
    if (id) return id;
    fail(401, 'Kod jest nieprawidłowy lub wygasł. Możesz pobrać nowy kod.');
  }
  fail(401, 'Sprawdź adres e-mail i kod.');
}

function register(state, body, signedIn) {
  const address = email(body.email);
  const name = text(body.name, 60, 'Nazwa wyświetlana');
  const {voyage, cabin} = invitation(state, body.token, false);
  const user = state.accounts.find(person => person.email === address);
  if (address === admin.email || (user && user.role !== 'guest')) fail(409, 'Użyj innego testowego adresu e-mail.');
  if (user && signedIn?.id !== user.id) fail(409, 'Masz już konto z tym adresem. Zaloguj się, aby dołączyć z zaproszenia.');
  return assignCabin(state, user, address, name, voyage, cabin);
}

function assignCabin(state, user, address, name, voyage, cabin) {
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

function joinDemoCabin(state, body, signedIn) {
  if (!equal(body.code, demoCabinCode)) fail(401, 'Wpisz kod demo 123456.');
  if (signedIn && signedIn.role !== 'guest') fail(403, 'Kod demo służy do dołączania gości.');
  const address = signedIn?.email ?? email(body.email);
  if (!signedIn && accountByEmail(state, address)) fail(409, 'Ten e-mail ma już konto. Zaloguj się własnym kodem.');
  const voyage = activeVoyage(state);
  if (!voyage) fail(409, 'Kod demo wymaga aktywnego rejsu.');
  if (membership(signedIn, voyage)) return signedIn.id;
  const cabin = state.cabins.find(item => item.voyageId === voyage.id && peopleIn(state, item) < item.capacity);
  if (!cabin) fail(409, 'W aktywnym rejsie nie ma wolnego miejsca w kabinach.');
  const name = 'Gość ' + cabin.label + ' (' + (peopleIn(state, cabin) + 1) + ')';
  return assignCabin(state, signedIn, address, name, voyage, cabin);
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
    case 'addCabin':
    case 'addCabins': {
      if (!voyage || voyage.id !== body.voyageId) fail(409, 'Odśwież aktywny rejs.');
      const labels = body.action === 'addCabin' ? [text(body.label, 24, 'Numer kabiny')] : cabinLabels(body.labels);
      const capacity = number(body.capacity, 1, 20, 'Liczba gości');
      const existing = new Set(state.cabins.filter(item => item.voyageId === voyage.id).map(item => item.label.toLowerCase()));
      const duplicate = labels.find(label => existing.has(label.toLowerCase()));
      if (duplicate) fail(409, 'Kabina ' + duplicate + ' już istnieje w tym rejsie.');
      state.cabins.push(...labels.map(label => ({id: randomUUID(), voyageId: voyage.id, label, capacity})));
      return {addedCabins: labels.length};
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

function saveEvent(state, body, user, voyage, placeFromMap) {
  const guestEvent = body.action === 'saveGuestEvent';
  if (guestEvent && !body.id && user.role !== 'guest') fail(403, 'Spotkania mogą tworzyć goście rejsu.');
  if (!guestEvent && !staff(user)) fail(403, 'Programem rejsu zarządzają plannerzy i administrator.');
  const event = body.id ? listed(state.events, body.id, 'Nie znaleziono wydarzenia.') : null;
  if (event && !manages(user, event)) fail(403, 'Możesz zarządzać własnymi wydarzeniami.');
  if (event && (event.source === 'guest') !== guestEvent) fail(400, 'Otwórz formularz właściwy dla tego wydarzenia.');
  if (event && (event.voyageId !== voyage.id || event.status === 'cancelled')) fail(409, 'Wydarzenie jest zamknięte.');
  if (event && body.revision !== event.revision) fail(409, 'Wydarzenie zostało zmienione. Otwórz aktualną wersję.');
  if (guestEvent && event && hasStarted(event)) fail(409, 'To spotkanie już się rozpoczęło.');
  if (guestEvent && !event && state.events.some(item => item.voyageId === voyage.id && item.ownerId === user.id &&
      item.source === 'guest' && item.status === 'published' && !hasStarted(item))) {
    fail(409, 'Masz już nadchodzące spotkanie w tym rejsie.');
  }
  const status = guestEvent || body.publish === true ? 'published' : 'draft';
  if (event?.status === 'published' && status === 'draft') fail(409, 'To wydarzenie jest już opublikowane.');
  if (!categories.includes(body.category)) fail(400, 'Wybierz kategorię.');
  const startsAt = parseTime(body.localTime, voyage.timeZone);
  if (Date.parse(startsAt) <= Date.now()) fail(400, 'Wybierz termin w przyszłości.');
  const capacity = guestEvent || body.capacity === null ? null : number(body.capacity, 1, 500, 'Limit miejsc');
  if (capacity !== null && event && capacity < event.attendees.length) fail(409, 'Limit jest mniejszy od liczby zapisów.');
  const title = text(body.title, 90, 'Nazwa wydarzenia');
  const place = guestEvent ? placeFromMap.name : text(body.place, 100, 'Miejsce');
  const description = text(body.description, 500, 'Opis', false);
  const changes = event?.status === 'published' ? [
    ...(event.startsAt !== startsAt ? ['termin'] : []),
    ...(event.place !== place || event.placeId !== placeFromMap?.id || event.deck !== placeFromMap?.deck ? ['miejsce'] : [])
  ] : [];
  const updated = {title, place, description, category: body.category, startsAt, localTime: body.localTime,
    ...(guestEvent && {placeId: placeFromMap.id, deck: placeFromMap.deck}),
    capacity, status, revision: (event?.revision ?? 0) + 1, changes: changes.length ? changes : event?.changes || []};
  const id = event?.id ?? randomUUID();
  if (event) Object.assign(event, updated);
  else state.events.push({...updated, id, ownerId: user.id, owner: user.name, voyageId: voyage.id,
    source: guestEvent ? 'guest' : 'program', attendees: guestEvent ? [user.id] : []});
  return {eventId: id};
}

function memberAction(state, body, user, voyage, placeFromMap) {
  switch (body.action) {
    case 'saveEvent': return saveEvent(state, body, user, voyage);
    case 'saveGuestEvent': return saveEvent(state, body, user, voyage, placeFromMap);
    case 'cancelEvent': {
      const event = listed(state.events, body.id, 'Nie znaleziono wydarzenia.');
      if (!manages(user, event)) fail(403, 'Możesz zarządzać własnymi wydarzeniami.');
      if (event.voyageId !== voyage.id || event.status === 'draft') fail(409, 'Wydarzenie jest zamknięte.');
      if (event.source === 'guest' && hasStarted(event)) fail(409, 'To spotkanie już się rozpoczęło.');
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
      if (hasStarted(event)) fail(409, 'Wydarzenie już się rozpoczęło.');
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
      if (body.age !== undefined) {
        const age = body.age === '' || body.age === null ? null : Number(body.age);
        if (age !== null && (!Number.isInteger(age) || age < 18 || age > 120)) fail(400, 'Wpisz wiek od 18 do 120 lat albo zostaw pole puste.');
        user.age = age;
      }
      if (body.roleOnShip !== undefined) user.roleOnShip = text(body.roleOnShip, 60, 'Rola na pokładzie', false);
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

const adminActions = new Set(['createVoyage', 'closeVoyage', 'addCabin', 'addCabins', 'issueQr', 'revokeQr',
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
    const existingAdminDigest = hosted && mongoUri && !configuredAdmin ? await crewAdminDigest() : null;
    if (dbName === (env.MONGODB_DATABASE || 'crewconnect') || (hosted && (!mongoUri || (!configuredAdmin && !existingAdminDigest)))) {
      return send(503, {error: 'Wspólne demo wymaga konfiguracji serwera.', code: 'DEMO_NOT_CONFIGURED'});
    }
    secret ??= await store.sessionSecret();
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
    if (body?.action === 'requestLoginCode') {
      const address = email(body.email);
      const user = accountByEmail(await store.read(), address);
      if (!user) return send(200, {demoSignup: true});
      if (!user.active) fail(404, 'To konto jest niedostępne.');
      if (staff(user)) return send(200, {requiresAccessCode: true});
      const token = loginBrowser(req) || randomBytes(24).toString('base64url');
      const code = String(randomInt(1_000_000)).padStart(6, '0');
      await store.change(state => issueGuestCode(state, address, digest('guest-browser:' + token), code));
      res.setHeader('Set-Cookie', cookie(loginCookieName, token, '/api/social', loginCodeSeconds));
      return send(200, {code});
    }
    if (['login', 'register', 'joinDemoCabin'].includes(body?.action)) {
      const assign = body.action === 'register' ? register : joinDemoCabin;
      const id = body.action === 'login' ? await login(req, await store.read(), body, existingAdminDigest) :
        await store.change(state => assign(state, body, session(req, state)));
      const state = await store.read();
      const account = id === admin.id ? admin : state.accounts.find(item => item.id === id && item.active);
      setSession(res, account);
      return send(200, board(state, account));
    }
    let placeFromMap;
    if (body?.action === 'saveGuestEvent') {
      const state = await store.read();
      const user = session(req, state);
      if (!user) fail(401, 'Zaloguj się ponownie.');
      const voyage = activeVoyage(state);
      if (!voyage || (!staff(user) && !membership(user, voyage))) fail(403, 'Dołącz do aktywnego rejsu.');
      const placeId = text(body.placeId, 64, 'Miejsce na mapie');
      placeFromMap = (await sharedPlaces()).find(place => place.id === placeId);
      if (!placeFromMap) fail(400, 'Wybierz dostępne miejsce z mapy statku.');
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
      return memberAction(state, body || {}, user, voyage, placeFromMap);
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
