const content = document.querySelector('#content');
const nav = document.querySelector('#navigation');
const sidebarProfile = document.querySelector('#sidebar-profile');
const sidebarAccount = document.querySelector('#sidebar-account');
const sidebarUserName = document.querySelector('#sidebar-user-name');
const roleLink = document.querySelector('#role-link');
const mapLink = document.querySelector('#ship-map-link');
const tripLabel = document.querySelector('#trip-label');
const connection = document.querySelector('#connection');
const dialog = document.querySelector('#dialog');
const status = document.querySelector('#notice');
const cacheKey = 'crewconnect-social-board-v1';
const logoutKey = 'crewconnect-social-logged-out';
const endpoint = '/api/social';
const apiBase = document.querySelector('meta[name="crewconnect-api"]').content;
const categories = ['Gry', 'Trening', 'Integracja', 'Inne'];
const eventSources = {program: 'Program rejsu', guest: 'Spotkania gości'};
const categoryIcons = {Gry: 'gamepad', Trening: 'activity', Integracja: 'users', Inne: 'star'};
const icons = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-4"/><circle cx="10" cy="7" r="4"/><path d="M17 3a4 4 0 0 1 0 8"/>',
  pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  arrow: '<path d="M9 18l6-6-6-6"/>',
  back: '<path d="m14 18-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gamepad: '<path d="M7 7h10a3 3 0 0 1 3 3l1 5a2 2 0 0 1-3 2l-2-2H8l-2 2a2 2 0 0 1-3-2l1-5a3 3 0 0 1 3-3Z"/><path d="M8 9v4m-2-2h4m6 0h.01m2 2h.01"/>',
  activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>'
};
const links = [
  ['wydarzenia', 'Wydarzenia'], ['kalendarz', 'Kalendarz'], ['poznaj', 'Poznaj załogę'],
  ['mapa', 'Mapa statku'], ['moje-zapisy', 'Moje zapisy']
];

const icon = name => '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const card = (inner, extra = '') => '<section class="surface ' + extra + '">' + inner + '</section>';
const empty = (title, detail = '') => card('<h2>' + title + '</h2>' + (detail ? '<p>' + detail + '</p>' : ''), 'empty');
const button = (label, action, id = '', extra = '', variant = '') =>
  '<button type="button" class="button ' + variant + '" data-action="' + action + '" data-id="' + escape(id) + '" ' + extra + '>' + label + '</button>';
const renderHeading = (title, detail = '', action = '') => '<header class="page-heading"><div><h1 tabindex="-1">' + title + '</h1>' +
  (detail ? '<p>' + detail + '</p>' : '') + '</div>' + action + '</header>';
const form = (action, fields, label, extra = '') => '<form data-form="' + action + '" ' + extra + '>' + fields +
  '<p class="form-error" role="alert" hidden></p><div class="form-actions">' + label + '</div></form>';
const submit = (label, value = '', style = 'primary') => '<button class="button ' + style + '" type="submit" value="' + value + '">' + label + '</button>';
const field = (label, name, value = '', attrs = '') => '<label>' + label + '<input name="' + name + '" value="' + escape(value) + '" ' + attrs + '></label>';
const textarea = (label, name, value = '', attrs = '') => '<label>' + label + '<textarea name="' + name + '" rows="3" ' + attrs + '>' + escape(value) + '</textarea></label>';
const back = (page, label) => '<a class="back" href="#' + page + '">' + icon('back') + label + '</a>';

let board;
let offline = false;
let cachedAt;
let connectionError;
let invite;
let month;
let day;
let adminTab = 'voyages';
let archiveId = '';
let filter = 'upcoming';
let noticeTimer;
let operation = false;
let refreshing = false;
let requestVersion = 0;
let chatPoll;

function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* The online app remains usable without local storage. */ }
}
function cachedBoard() {
  if (readLocal(logoutKey)) return null;
  try {
    const cached = JSON.parse(readLocal(cacheKey));
    return cached?.board?.user ? cached : null;
  } catch { return null; }
}
function updateBoard(next) {
  board = next;
  offline = false;
  connectionError = '';
  if (!next.user || !next.access || !next.voyage) {
    writeLocal(cacheKey, null);
    return;
  }
  const {user, voyage, events} = next;
  const snapshot = {user: {id: user.id, role: user.role}, voyage, access: true, events: events.filter(event =>
    event.voyageId === voyage.id && (event.status === 'published' || (event.joined && event.status === 'cancelled')))
    .map(({attendees, canManage, ...event}) => event)};
  cachedAt = Date.now();
  writeLocal(cacheKey, JSON.stringify({board: snapshot, at: cachedAt}));
}
function route() {
  const hash = location.hash.slice(1);
  const [page, query = ''] = hash.split('?');
  const [section, id] = page.split('/');
  const params = new URLSearchParams(query);
  return {page: section || 'wydarzenia', id, token: params.get('kod'), date: params.get('dzien')};
}
function navigate(target) {
  if (location.hash === '#' + target) render(true);
  else location.hash = target;
}
const eventDay = event => event.localTime.slice(0, 10);
const eventTime = event => event.localTime.slice(11, 16);
const eventDate = event => new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short'
}).format(new Date(event.localTime + 'Z'));
const isPast = event => Date.parse(event.startsAt) <= Date.now();
const activeEvents = () => (board.events || []).filter(event => event.voyageId === board.voyage?.id);
const upcoming = () => activeEvents().filter(event => event.status === 'published' && !isPast(event)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
const eventById = id => board.events?.find(event => event.id === id);
const previewDate = value => new Intl.DateTimeFormat('pl-PL', {timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long'})
  .format(new Date(value + 'T12:00Z'));
const sourceOf = event => event.source === 'guest' ? 'guest' : 'program';

function announce(message) {
  clearTimeout(noticeTimer);
  status.textContent = message;
  noticeTimer = setTimeout(() => { status.textContent = ''; }, 4200);
}

async function request(payload, suffix = '') {
  const response = await fetch(endpoint + suffix, payload ? {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), cache: 'no-store'
  } : {cache: 'no-store'});
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) throw Object.assign(new Error(json?.error || 'Demo jest dostępne pod adresem serwera CrewConnect.'),
    {status: response.status, code: json?.code});
  return json;
}

async function refresh(force = false) {
  if (refreshing || operation || (readLocal(logoutKey) && !readLocal(logoutKey).startsWith('pending'))) return;
  refreshing = true;
  const version = requestVersion;
  try {
    if (readLocal(logoutKey) === 'pending') {
      await request({action: 'logout'});
      if (version !== requestVersion) return;
      writeLocal(logoutKey, 'done');
      updateBoard({user: null});
    } else {
      const next = await request();
      if (version !== requestVersion) return;
      const changed = force || offline || JSON.stringify(board) !== JSON.stringify(next);
      updateBoard(next);
      if (!changed) return;
    }
    if (route().page !== 'rejestracja') render();
  } catch (error) {
    if (version !== requestVersion) return;
    const cached = cachedBoard();
    if (error.code === 'DEMO_NOT_CONFIGURED' && !cached && route().page !== 'rejestracja') {
      location.replace(new URL('legacy.html' + location.hash, location.href));
      return;
    }
    if (cached) {
      board = cached.board;
      cachedAt = cached.at;
      offline = true;
    } else {
      connectionError = error.status ? error.message : 'Sprawdź połączenie i spróbuj ponownie.';
      board ||= {user: null};
    }
    if (route().page !== 'rejestracja') render();
  } finally {
    refreshing = false;
  }
}

async function loadInvite(token) {
  if (!token) {
    invite = {error: 'Zeskanuj kod QR dostępny w swojej kabinie.'};
    render();
    return;
  }
  invite = null;
  render();
  try {
    const details = await request(null, '?invite=' + encodeURIComponent(token));
    if (route().token !== token) return;
    invite = details;
  } catch (error) {
    if (route().token !== token) return;
    invite = {error: error.status ? error.message : 'Połącz się z internetem i ponownie otwórz zaproszenie.'};
  }
  render();
}

function renderLogin(page) {
  const emailField = field('Testowy adres e-mail', 'email', '', 'type="email" autocomplete="username" required maxlength="120"');
  const codeField = field('Kod dostępu', 'code', '', 'type="password" autocomplete="current-password" required maxlength="100"');
  if (page === 'rejestracja') {
    const login = 'logowanie?kod=' + encodeURIComponent(route().token || '');
    return '<div class="auth-view">' + back(login, 'Mam już konto') +
      renderHeading('Dołącz do rejsu', invite?.cabin ? escape(invite.voyage) : '') +
      (invite?.cabin ? card('<div class="cabin-label">' + icon('pin') + '<div><small>Kabina z zaproszenia</small><strong>' +
        escape(invite.cabin) + '</strong></div></div>' +
        (invite.full ? '<p>Wszystkie miejsca w tej kabinie zostały wykorzystane. Jeśli masz już konto, zaloguj się.</p>' +
          '<a class="button secondary" href="#' + login + '">Przejdź do logowania</a>' :
          form('register', field('Nazwa wyświetlana', 'name', '', 'autocomplete="nickname" required maxlength="60"') +
            emailField, submit(board?.user?.role === 'guest' ? 'Dołącz do rejsu' : 'Utwórz konto')))) :
        empty(invite?.error ? 'Zaproszenie niedostępne' : 'Sprawdzamy zaproszenie', escape(invite?.error || 'To potrwa chwilę.'))) + '</div>';
  }
  return '<div class="auth-view">' + renderHeading('Życie na pokładzie', 'Zaloguj się, aby zobaczyć wydarzenia swojego rejsu.') +
    (connectionError ? '<p class="notice warning">' + escape(connectionError) + '</p>' : '') +
    card('<h2>Zaloguj się</h2>' + form('login', emailField + codeField, submit('Zaloguj się')) +
      '<p class="input-note">Kod demo dla gości: <strong>123456</strong>.</p>') +
    card('<h2>Pierwszy raz na pokładzie?</h2><p>Zeskanuj aparatem kod QR dostępny w swojej kabinie.</p>') + '</div>';
}

function eventBadge(event) {
  if (event.status === 'draft') return '<span class="pill muted">Szkic</span>';
  if (event.status === 'cancelled') return '<span class="pill warning">Odwołane</span>';
  if (isPast(event)) return '<span class="pill muted">Minione</span>';
  if (event.joined) return '<span class="pill positive">Zapisano</span>';
  return '';
}

function availability(event) {
  if (event.capacity === null) return event.count + ' zapisanych';
  const remaining = event.capacity - event.count;
  return remaining > 0 ? 'Wolne miejsca: ' + remaining + ' / ' + event.capacity : 'Brak wolnych miejsc';
}

const sourceBadge = source => '<span class="source-badge source-' + source + '">' + eventSources[source] + '</span>';
const placeLabel = event => escape(event.place) + (event.deck ? ' · pokład ' + escape(event.deck) : '');

function signupAction(event, compact = false) {
  if (event.voyageId !== board.voyage?.id || event.status !== 'published' || isPast(event)) return '';
  const full = event.capacity !== null && event.count >= event.capacity;
  const label = event.joined ? 'Wypisz się' : full ? 'Brak miejsc' : 'Zapisz się';
  const attributes = (offline || (!event.joined && full) ? 'disabled ' : '') +
    (compact ? 'aria-label="' + label + ' — ' + escape(event.title) + '"' : '');
  return button(label, event.joined ? 'leave' : 'join', event.id, attributes, event.joined ? 'secondary' : 'primary');
}

function eventCard(event, panel = false) {
  const group = categories.indexOf(event.category);
  return '<article class="surface event-card source-' + sourceOf(event) + '"><div class="event-card-top">' +
    sourceBadge(sourceOf(event)) + eventBadge(event) + '</div>' +
    '<h3><a href="#wydarzenie/' + escape(event.id) + '">' + escape(event.title) + '</a></h3>' +
    '<div class="event-meta"><span>' + icon('calendar') + '<time datetime="' + escape(event.startsAt) + '">' + eventDate(event) + ', ' + eventTime(event) + '</time></span>' +
    '<span>' + icon('pin') + placeLabel(event) + '</span></div>' +
    '<span class="event-category category-' + group + '">' + icon(categoryIcons[event.category]) + escape(event.category) + '</span>' +
    '<footer><span>' + escape(availability(event)) + '</span><a class="text-link" href="#' +
    (panel && event.status === 'draft' && event.voyageId === board.voyage?.id ? 'edytuj/' : 'wydarzenie/') +
    escape(event.id) + '">' + (panel && event.status === 'draft' && event.voyageId === board.voyage?.id ? 'Edytuj' : 'Szczegóły') +
    icon('arrow') + '</a></footer></article>';
}

const eventGrid = (events, panel = false) => '<div class="event-grid">' + events.map(event => eventCard(event, panel)).join('') + '</div>';

function eventSections(events, panel = false) {
  return Object.entries(eventSources).map(([source, label]) => {
    const items = events.filter(event => sourceOf(event) === source);
    return '<section class="event-section" aria-labelledby="event-section-' + source + '"><h2 id="event-section-' + source + '">' +
      label + '</h2>' + (items.length ? eventGrid(items, panel) : '<p class="surface section-empty">' +
        (source === 'guest' ? 'Brak spotkań gości.' : 'Brak wydarzeń w programie.') + '</p>') + '</section>';
  }).join('');
}

function guestEventAction(date = '') {
  if (offline || !board.access || !board.voyage || board.user.role !== 'guest') return '';
  const own = upcoming().find(event => sourceOf(event) === 'guest' && event.ownerId === board.user.id);
  return own ? '<a class="button secondary" href="#wydarzenie/' + escape(own.id) + '">Moje spotkanie</a>' :
    '<a class="button primary" href="#dodaj-spotkanie' + (date ? '?dzien=' + encodeURIComponent(date) : '') + '">' +
    icon('plus') + 'Dodaj spotkanie</a>';
}

function todayDate() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: board.voyage?.timeZone || 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function renderCalendar() {
  const events = activeEvents().filter(event => event.status === 'published').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const today = todayDate();
  day ||= today;
  month ||= day.slice(0, 7);
  const first = new Date(month + '-01T12:00Z');
  const offset = (first.getUTCDay() + 6) % 7;
  const eventsByDay = new Map();
  for (const event of events) {
    const date = eventDay(event);
    if (!eventsByDay.has(date)) eventsByDay.set(date, []);
    eventsByDay.get(date).push(event);
  }
  const cells = Array.from({length: 42}, (_, i) => {
    const cell = new Date(first);
    cell.setUTCDate(i - offset + 1);
    const date = cell.toISOString().slice(0, 10);
    const listings = eventsByDay.get(date) || [];
    const bySource = Object.keys(eventSources).map(source => [source, listings.filter(event => sourceOf(event) === source)]);
    return '<button type="button" class="calendar-day' + (date.startsWith(month) ? '' : ' outside') + '" data-action="day" data-id="' +
      date + '" aria-pressed="' + (day === date) + '" aria-label="' + previewDate(date) + (listings.length ?
        bySource.filter(([, items]) => items.length).map(([source, items]) => ', ' + eventSources[source] + ' ' + items.length).join('') :
        ', brak wydarzeń') + '"' + (today === date ? ' aria-current="date"' : '') + '><span class="day-number">' + cell.getUTCDate() + '</span>' +
      '<span class="calendar-markers" aria-hidden="true">' + bySource.filter(([, items]) => items.length).map(([source, items]) =>
        '<span class="calendar-event source-' + source + '">' + eventTime(items[0]) + ' ' + escape(items[0].title) +
        (items.length > 1 ? ' · +' + (items.length - 1) : '') + '</span>').join('') + '</span></button>';
  }).join('');
  const label = new Intl.DateTimeFormat('pl-PL', {timeZone: 'UTC', month: 'long', year: 'numeric'}).format(first);
  const agenda = (eventsByDay.get(day) || []).map(event => '<article class="agenda-item source-' + sourceOf(event) + '"><time datetime="' +
    escape(event.startsAt) + '">' + eventTime(event) + '</time><div class="agenda-info">' + sourceBadge(sourceOf(event)) +
    eventBadge(event) + '<h3><a href="#wydarzenie/' + escape(event.id) + '">' + escape(event.title) + '</a></h3><p>' +
    placeLabel(event) + '</p><p>' + escape(availability(event)) + '</p></div>' + signupAction(event, true) + '</article>').join('');
  return '<section class="calendar" aria-labelledby="calendar-title"><header class="calendar-header">' +
      '<div><h1 id="calendar-title" tabindex="-1">Kalendarz rejsu</h1><h2>' + label + '</h2></div><div class="calendar-controls">' +
      button('Dzisiaj', 'today', '', '', 'secondary') +
      button('‹', 'month', '-1', 'aria-label="Poprzedni miesiąc"', 'secondary') +
      button('›', 'month', '1', 'aria-label="Następny miesiąc"', 'secondary') +
      '</div></header><div class="calendar-legend">' + Object.keys(eventSources).map(sourceBadge).join('') +
      '</div><div class="calendar-grid">' + ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd']
        .map(text => '<span class="weekday">' + text + '</span>').join('') +
      cells + '</div></section>' +
    card('<header><h2>' + previewDate(day) + '</h2>' + guestEventAction(day >= today ? day : '') + '</header>' +
      (agenda || '<p>Tego dnia nie ma wydarzeń.</p>'), 'agenda');
}

function renderEvents() {
  return renderHeading('Wydarzenia', 'Nadchodzące aktywności na pokładzie', guestEventAction()) + eventSections(upcoming());
}

function renderBookings() {
  const events = activeEvents().filter(event => event.joined && (filter === 'upcoming' ?
    !isPast(event) : isPast(event)))
    .sort((a, b) => filter === 'upcoming' ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt));
  return renderHeading('Moje zapisy') + '<div class="segmented section-tabs">' +
    button('Nadchodzące', 'bookings', 'upcoming', 'aria-pressed="' + (filter === 'upcoming') + '"') +
    button('Historia', 'bookings', 'history', 'aria-pressed="' + (filter === 'history') + '"') + '</div>' +
    (events.length ? '<div class="event-grid">' + events.map(event => '<div>' +
      (event.changes.length && event.status === 'published' ? '<p class="change-note">Zmieniono: ' + escape(event.changes.join(' i ')) + '</p>' : '') +
      eventCard(event) + '</div>').join('') + '</div>' : empty(filter === 'history' ? 'Brak historii zapisów' : 'Brak nadchodzących zapisów'));
}

function renderDetail(id) {
  const event = eventById(id);
  if (!event) return back('wydarzenia', 'Wydarzenia') + renderHeading('Wydarzenie niedostępne');
  const current = event.voyageId === board.voyage?.id;
  const guestEvent = sourceOf(event) === 'guest';
  const manageable = current && event.canManage && !offline && event.status !== 'cancelled' && (!guestEvent || !isPast(event));
  const signup = signupAction(event);
  const place = event.placeId ? '<a class="text-link" href="#mapa/' + escape(event.placeId) + '">' + placeLabel(event) + '</a>' :
    '<strong>' + placeLabel(event) + '</strong>';
  return back(event.status === 'draft' || !current ? (board.user.role === 'admin' ? 'admin' : 'planner') : 'wydarzenia', 'Wróć') +
    '<div class="detail-view">' + card('<div class="event-card-top"><div class="event-tags">' + sourceBadge(sourceOf(event)) +
      '<span class="event-category category-' + categories.indexOf(event.category) + '">' + icon(categoryIcons[event.category]) +
      escape(event.category) + '</span></div>' + eventBadge(event) + '</div>' + renderHeading(escape(event.title)) +
      '<div class="detail-facts"><div>' + icon('calendar') + '<span><strong>' + eventDate(event) + ', ' + eventTime(event) +
      '</strong><small>' + escape(board.voyage?.timeZone && current ? board.voyage.timeZone :
        board.voyages?.find(voyage => voyage.id === event.voyageId)?.timeZone) + '</small></span></div><div>' +
      icon('pin') + place + '</div><div>' + icon('users') + '<span>' +
      '<strong>' + escape(availability(event)) + '</strong><small>Organizator: ' + escape(event.owner) + '</small></span></div></div>' +
      (event.changes.length ? '<p class="change-note">Zmieniono: ' + escape(event.changes.join(' i ')) + '</p>' : '') +
      (event.description ? '<h2>O wydarzeniu</h2><p class="event-description">' + escape(event.description) + '</p>' : '') +
      (signup ? '<div class="detail-action">' + signup + '</div>' : ''), 'detail-card') +
    (event.canManage && !offline ? card('<h2>Lista zapisanych</h2>' + (event.attendees?.length ?
      '<ul class="attendees">' + event.attendees.map(name => '<li>' + escape(name) + '</li>').join('') + '</ul>' : '<p>Brak zapisów.</p>') +
      (manageable ? '<div class="button-row"><a class="button secondary" href="#' + (guestEvent ? 'edytuj-spotkanie/' : 'edytuj/') +
        escape(id) + '">Edytuj</a>' +
        (event.status === 'published' && !isPast(event) ? button('Odwołaj wydarzenie', 'cancelEvent', id, '', 'danger') : '') + '</div>' : '')) : '') +
    '</div>';
}

const categoryField = selected => '<label>Kategoria<select name="category">' + categories.map(category => '<option' +
  (selected === category ? ' selected' : '') + '>' + category + '</option>').join('') + '</select></label>';

function renderEventForm(id) {
  const event = id ? eventById(id) : null;
  const panel = board.user.role === 'admin' ? 'admin' : 'planner';
  if (offline || !board.voyage || board.user.role === 'guest' ||
      (id && (!event?.canManage || sourceOf(event) === 'guest' || event.voyageId !== board.voyage.id || event.status === 'cancelled'))) {
    return back(panel, 'Panel') + renderHeading('Formularz niedostępny');
  }
  const fields = field('Nazwa wydarzenia', 'title', event?.title, 'maxlength="90" required') +
    categoryField(event?.category) +
    field('Miejsce', 'place', event?.place, 'maxlength="100" required') +
    field('Data i godzina · ' + escape(board.voyage.timeZone), 'localTime', event?.localTime, 'type="datetime-local" required') +
    field('Limit miejsc (opcjonalny)', 'capacity', event?.capacity, 'type="number" min="1" max="500" inputmode="numeric"') +
    textarea('Opis (opcjonalny)', 'description', event?.description, 'maxlength="500"');
  const actions = event?.status === 'published' ? submit('Zapisz zmiany', 'publish') :
    submit('Opublikuj', 'publish') + submit('Zapisz szkic', 'draft', 'secondary');
  return '<div class="form-view">' + back(id ? 'wydarzenie/' + id : panel, id ? 'Wydarzenie' : 'Panel') +
    renderHeading(id ? 'Edytuj wydarzenie' : 'Dodaj wydarzenie') +
    card(form('saveEvent', fields, actions, 'data-id="' + escape(id) + '" data-revision="' + escape(event?.revision) + '"')) + '</div>';
}

function renderGuestEventForm(id, date) {
  const event = id ? eventById(id) : null;
  const backLink = back(id ? 'wydarzenie/' + escape(id) : date ? 'kalendarz' : 'wydarzenia', id ? 'Spotkanie' : date ? 'Kalendarz' : 'Wydarzenia');
  if (offline || !board.access || !board.voyage || (id ?
    !event?.canManage || sourceOf(event) !== 'guest' || event.voyageId !== board.voyage.id ||
      event.status !== 'published' || isPast(event) : board.user.role !== 'guest')) {
    return backLink + renderHeading('Formularz niedostępny');
  }
  const own = !id && upcoming().find(item => sourceOf(item) === 'guest' && item.ownerId === board.user.id);
  if (own) return backLink + renderHeading('Masz już nadchodzące spotkanie') +
    '<a class="button primary" href="#wydarzenie/' + escape(own.id) + '">Otwórz moje spotkanie</a>';
  const today = todayDate();
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today ? date : today;
  const fields = field('Temat spotkania', 'title', event?.title, 'maxlength="90" required placeholder="Np. kawa i planszówki"') +
    categoryField(event?.category ?? 'Integracja') +
    '<div class="meeting-location"><div><span>Miejsce spotkania</span>' +
    '<p id="selected-place">' + (event ? placeLabel(event) : 'Wybierz miejsce z mapy statku.') + '</p></div>' +
    '<input type="hidden" name="placeId" value="' + escape(event?.placeId) + '">' +
    button(icon('pin') + (event ? 'Zmień miejsce' : 'Otwórz mapę'), 'pickMeetingPlace', '',
      'aria-haspopup="dialog" aria-describedby="selected-place"', 'secondary') + '</div>' +
    '<fieldset class="event-term"><legend>Termin · ' + escape(board.voyage.timeZone) + '</legend><div>' +
    field('Data', 'date', event ? eventDay(event) : selectedDate, 'type="date" required min="' + today + '"') +
    field('Godzina', 'time', event ? eventTime(event) : '', 'type="time" required') + '</div></fieldset>' +
    textarea('Opis (opcjonalny)', 'description', event?.description, 'maxlength="500"');
  return '<div class="form-view">' + backLink + renderHeading(id ? 'Edytuj spotkanie' : 'Dodaj spotkanie',
    id ? '' : 'Możesz mieć jedno nadchodzące spotkanie na tym rejsie.') +
    card(form('saveGuestEvent', fields, submit(id ? 'Zapisz zmiany' : 'Opublikuj spotkanie'),
      'data-id="' + escape(id) + '" data-revision="' + escape(event?.revision) + '"')) + '</div>';
}

function renderPeople() {
  const user = board.user;
  const profiles = board.profiles || [];
  const candidate = profiles.find(profile => !profile.choice);
  const matches = profiles.filter(profile => profile.match);
  return renderHeading('Poznaj załogę', 'Osoby z Twojego rejsu',
    !offline && user.role === 'guest' ? button('Usuń historię dopasowań', 'resetMatches', '', '', 'secondary') : '') +
    (offline ? empty('Dopasowania są dostępne online') : user.role !== 'guest' ? empty('Dopasowania są dostępne dla gości rejsu') :
      !user.visible ? card('<h2>Pokaż swój profil</h2><p>Po włączeniu widoczności możesz przeglądać karty i zobaczyć wzajemne dopasowania.</p>' +
        '<a class="button primary" href="#konto">Ustaw widoczność profilu</a>', 'empty') :
        '<div class="people-grid"><div>' + (candidate ?
          card('<div class="portrait">' + escape(initials(candidate.name)) + '</div><div class="person-content"><h2>' +
            escape(candidate.name) + (candidate.age ? ', ' + escape(candidate.age) : '') + '</h2>' +
            (candidate.roleOnShip ? '<p>' + escape(candidate.roleOnShip) + '</p>' : '') + (candidate.bio ? '<p>' + escape(candidate.bio) + '</p>' : '') +
            '<div class="interests">' + candidate.interests.map(item => '<span class="pill muted">' + escape(item) + '</span>').join('') +
            '</div><div class="people-actions">' + button('Pomiń', 'skip', candidate.id, '', 'secondary') +
            button('Chcę poznać', 'connect', candidate.id, '', 'primary') + '</div></div>', 'person-card') :
          empty('Brak nowych kart', 'Nowe osoby pojawią się tutaj po włączeniu widoczności.')) +
        '</div>' + card('<h2>Dopasowania</h2>' + (matches.length ? '<ul class="matches">' + matches.map(profile =>
          '<li><span class="avatar">' + escape(initials(profile.name)) + '</span><div><strong>' + escape(profile.name) +
          '</strong>' + (profile.bio ? '<p>' + escape(profile.bio) + '</p>' : '') + '</div>' +
          button('Czat', 'chat', profile.id, 'aria-label="Czat z ' + escape(profile.name) + '"', 'secondary') +
          '</li>').join('') + '</ul>' :
          '<p>Dopasowanie pojawi się, gdy obie osoby wybiorą „Chcę poznać”.</p>')) + '</div>');
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toUpperCase();
}

function account() {
  const user = board.user;
  const guest = user.role === 'guest';
  return '<div class="form-view">' + renderHeading('Konto') +
    (offline ? empty('Profil jest dostępny online') :
      card('<div class="account-head"><span class="avatar">' + escape(initials(user.name)) + '</span><div><h2>' +
        escape(user.name) + '</h2>' + (user.cabin ? '<p>Kabina ' + escape(user.cabin) + '</p>' : '') + '</div></div>' +
        (user.role === 'admin' || !board.voyage ? '' : form('profile',
          field('Nazwa wyświetlana', 'name', user.name, 'required maxlength="60"') +
          (guest ? field('Wiek (opcjonalnie)', 'age', user.age ?? '', 'type="number" min="18" max="120" step="1" inputmode="numeric"') +
            field('Rola na pokładzie', 'roleOnShip', user.roleOnShip, 'maxlength="60"') +
            textarea('O mnie', 'bio', user.bio, 'maxlength="240"') +
            field('Zainteresowania (oddziel przecinkami)', 'interests', user.interests.join(', '), 'maxlength="160"') +
            '<label class="check"><input name="visible" type="checkbox" ' + (user.visible ? 'checked' : '') +
            '> Pokaż mój profil w „Poznaj załogę”</label>' : ''), submit('Zapisz profil'))))) +
    '<div class="account-footer">' + button('Wyloguj się', 'logout', '', '', 'secondary') + '</div></div>';
}

function planner() {
  const online = !offline && board.voyage;
  return renderHeading('Panel plannera', 'Twoje wydarzenia', online ?
    '<a class="button primary" href="#dodaj">' + icon('plus') + 'Dodaj wydarzenie</a>' : '') +
    (!online ? empty(offline ? 'Panel jest dostępny online' : 'Brak aktywnego rejsu') :
      adminEvents(activeEvents().filter(event => event.ownerId === board.user.id)));
}

function adminEvents(events) {
  const sorted = [...events].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return sorted.length ? eventGrid(sorted, true) : empty('Brak wydarzeń', 'Tutaj pojawią się szkice i opublikowane wydarzenia.');
}

function adminVoyages() {
  const voyage = board.voyage;
  const history = board.voyages.filter(item => !item.active);
  const cabins = board.cabins.filter(cabin => cabin.voyageId === voyage?.id);
  return '<div class="admin-grid">' + (voyage ?
    card('<div class="admin-title"><div><h2>' + escape(voyage.name) + '</h2><p>' + escape(voyage.timeZone) + '</p></div>' +
      '<span class="pill positive">Aktywny rejs</span></div>' +
      button('Zakończ rejs', 'closeVoyage', voyage.id, '', 'danger')) +
    card('<h2>Dodaj kabiny</h2>' + form('addCabins',
      textarea('Numery kabin', 'labels', '', 'required maxlength="4096" placeholder="101–110, A12" aria-describedby="cabin-hint"') +
      '<p id="cabin-hint" class="input-note">Podaj pojedyncze numery i zakresy. Oddziel je przecinkami lub nowymi wierszami.</p>' +
      field('Liczba gości na kabinę', 'capacity', '2', 'type="number" min="1" max="20" required'), submit('Dodaj kabiny'))) :
    card('<h2>Utwórz rejs</h2>' + form('createVoyage', field('Nazwa rejsu', 'name', '', 'required maxlength="80"') +
      field('Strefa czasowa', 'timeZone', 'Europe/Warsaw', 'required maxlength="80"'), submit('Utwórz rejs')))) + '</div>' +
    (voyage ? '<h2 class="section-title">Kabiny</h2>' + (cabins.length ? '<div class="rows">' + cabins.map(cabin =>
      card('<div><h3>Kabina ' + escape(cabin.label) + '</h3><p>' + cabin.used + ' / ' + cabin.capacity + ' kont · ' +
        (cabin.hasCode ? 'QR aktywny' : 'Brak aktywnego QR') + '</p></div><div class="button-row">' +
        button(cabin.hasCode ? 'Odnów QR' : 'Generuj QR', 'issueQr', cabin.id, 'data-replace="' + cabin.hasCode + '"', 'secondary') +
        (cabin.hasCode ? button('Unieważnij', 'revokeQr', cabin.id, '', 'danger') : '') + '</div>', 'admin-row')).join('') +
      '</div>' : empty('Dodaj pierwszą kabinę')) : '') +
    '<h2 class="section-title">Archiwum rejsów</h2>' + (history.length ? '<div class="rows">' + history.map(item =>
      card('<div><h3>' + escape(item.name) + '</h3><p>' + escape(item.timeZone) + '</p></div>' +
        button('Pokaż wydarzenia', 'archive', item.id, '', 'secondary'), 'admin-row')).join('') + '</div>' :
      empty('Brak zakończonych rejsów'));
}

function adminAccounts() {
  return card('<h2>Utwórz konto plannera</h2>' + form('createPlanner',
    field('Nazwa plannera', 'name', '', 'required maxlength="60"') +
    field('Testowy adres e-mail', 'email', '', 'type="email" required maxlength="120"'), submit('Utwórz konto')), 'form-view') +
    '<h2 class="section-title">Plannerzy</h2>' +
    (board.planners.length ? '<div class="rows">' + board.planners.map(person => card('<div><h3>' + escape(person.name) +
      '</h3><p>' + escape(person.email) + ' · ' + (person.active ? 'Aktywne' : 'Nieaktywne') + '</p></div><div class="button-row">' +
      button(person.active ? 'Dezaktywuj' : 'Aktywuj', 'togglePlanner', person.id, 'data-active="' + !person.active + '"', 'secondary') +
      button('Nowy kod', 'resetPlannerCode', person.id, '', 'secondary') + '</div>', 'admin-row')).join('') + '</div>' :
      empty('Brak kont plannerów'));
}

function renderAdmin() {
  const tabs = [['voyages', 'Rejsy i kabiny'], ['accounts', 'Konta'], ['events', 'Wydarzenia']];
  const archive = board.voyages?.find(voyage => voyage.id === archiveId);
  return renderHeading('Panel admina', '', !offline && board.voyage && adminTab === 'events' && !archive ?
      '<a class="button primary" href="#dodaj">' + icon('plus') + 'Dodaj wydarzenie</a>' : '') +
    (offline ? empty('Panel jest dostępny online') :
      '<div class="segmented section-tabs" aria-label="Sekcje panelu admina">' + tabs.map(([key, label]) =>
        button(label, 'adminTab', key, 'aria-pressed="' + (adminTab === key) + '"')).join('') + '</div>' +
      (adminTab === 'voyages' ? adminVoyages() : adminTab === 'accounts' ? adminAccounts() :
        (archive ? '<div class="toolbar"><h2>' + escape(archive.name) + ' · Archiwum</h2>' +
          button('Aktywny rejs', 'archive', '', '', 'secondary') + '</div>' : '') +
        eventSections((archive ? board.events.filter(event => event.voyageId === archive.id) : activeEvents())
          .sort((a, b) => b.startsAt.localeCompare(a.startsAt)), true)));
}

function render(focus = false) {
  const {page, id, date} = route();
  if (['aktywnosci', 'raporty', 'plan-zalogi', 'dziennik-raportow', 'zaloga', 'profil'].includes(page)) {
    const target = {zaloga: 'poznaj', profil: 'konto'}[page] || 'wydarzenia';
    history.replaceState(null, '', '#' + target);
    return render(focus);
  }
  const user = board?.user;
  const displayNav = Boolean(user) && page !== 'rejestracja';
  const parent = ['wydarzenie', 'dodaj-spotkanie', 'edytuj-spotkanie'].includes(page) ? 'wydarzenia' : page;
  nav.hidden = !displayNav;
  nav.innerHTML = displayNav ? '<div class="nav-group" role="group" aria-labelledby="nav-life"><p id="nav-life">Życie na pokładzie</p>' +
    links.map(([key, label]) => '<a href="#' + key + '"' +
      (parent === key ? ' aria-current="page"' : '') + '>' + label + '</a>').join('') + '</div>' : '';
  sidebarProfile.hidden = !displayNav;
  sidebarUserName.textContent = displayNav ? user.name || '' : '';
  if (displayNav && page === 'konto') sidebarAccount.setAttribute('aria-current', 'page');
  else sidebarAccount.removeAttribute('aria-current');
  mapLink.hidden = displayNav;
  roleLink.hidden = !displayNav || user.role === 'guest';
  if (!roleLink.hidden) {
    roleLink.href = user.role === 'admin' ? '#admin' : '#planner';
    roleLink.textContent = user.role === 'admin' ? 'Panel admina' : 'Panel plannera';
  }
  tripLabel.textContent = displayNav ? board.voyage?.name || '' : '';
  connection.hidden = !offline || !displayNav;
  connection.textContent = offline && cachedAt ? 'Offline · dane z ' + new Date(cachedAt).toLocaleString('pl-PL', {dateStyle: 'short', timeStyle: 'short'}) : '';
  const canUseBoard = board?.access && board.voyage;
  content.classList.toggle('map-content', page === 'mapa');
  if (page === 'mapa') renderMap(id);
  else if (page === 'rejestracja' || page === 'logowanie' || (!user && board)) content.innerHTML = renderLogin(page);
  else if (!board) content.innerHTML = empty('Ładujemy CrewConnect');
  else if (page === 'konto') content.innerHTML = account();
  else if (page === 'admin' && user.role === 'admin') content.innerHTML = renderAdmin();
  else if (page === 'planner' && user.role === 'planner') content.innerHTML = planner();
  else if ((page === 'dodaj' || page === 'edytuj') && user.role !== 'guest') content.innerHTML = renderEventForm(id);
  else if (page === 'dodaj-spotkanie' || page === 'edytuj-spotkanie') content.innerHTML = renderGuestEventForm(id, date);
  else if (page === 'wydarzenie' && (canUseBoard || user.role === 'admin')) content.innerHTML = renderDetail(id);
  else if (!canUseBoard) content.innerHTML = renderHeading(user.role === 'guest' ? 'Dołącz do rejsu' : 'Wydarzenia') +
    empty(user.role === 'guest' ? 'Zeskanuj kod w kabinie' : 'Brak aktywnego rejsu',
      user.role === 'guest' ? 'Zaproszenie QR przypisze Twoje konto do kabiny w bieżącym rejsie.' : '');
  else if (page === 'moje-zapisy') content.innerHTML = renderBookings();
  else if (page === 'kalendarz') content.innerHTML = renderCalendar();
  else if (page === 'poznaj') content.innerHTML = renderPeople();
  else content.innerHTML = renderEvents();
  if (focus) {
    (content.querySelector('h1') || content).focus({preventScroll: true});
    window.scrollTo(0, 0);
  }
}

function renderMap(id) {
  const src = 'navigation.html?embed=1' + (id ? '&place=' + encodeURIComponent(id) : '');
  if (content.querySelector('.ship-map-frame')?.getAttribute('src') === src) return;
  content.innerHTML = '<iframe class="ship-map-frame" title="Mapa statku" src="' + escape(src) + '"></iframe>';
}

function showResult(title, body, actions = '') {
  dialog.innerHTML = '<header><h2 id="dialog-title">' + title + '</h2><button type="button" class="button" data-close aria-label="Zamknij">×</button></header>' +
    body + actions;
  dialog.showModal();
}
dialog.addEventListener('click', event => {
  if (event.target.closest('[data-close]')) dialog.close();
  if (event.target.closest('[data-print]')) window.print();
});
dialog.addEventListener('close', () => {
  clearInterval(chatPoll);
  dialog.innerHTML = '';
});

function openMeetingMap(control) {
  if (dialog.open) return;
  const placeId = control.form.elements.placeId.value;
  const src = 'navigation.html?embed=1&pick=1' + (placeId ? '&place=' + encodeURIComponent(placeId) : '');
  showResult('Wybierz miejsce na statku', '<iframe class="place-picker-frame" title="Wybór miejsca na mapie" src="' + escape(src) + '"></iframe>');
}

window.addEventListener('message', event => {
  if (!dialog.open || event.origin !== location.origin ||
      event.source !== dialog.querySelector('.place-picker-frame')?.contentWindow) return;
  if (event.data?.type === 'crewconnect-place-cancel') return dialog.close();
  if (event.data?.type !== 'crewconnect-place-selected') return;
  const place = event.data.place;
  const form = content.querySelector('[data-form="saveGuestEvent"]');
  if (!form || typeof place?.id !== 'string' || typeof place.name !== 'string' || !Number.isInteger(place.deck)) return;
  form.elements.placeId.value = place.id;
  form.querySelector('#selected-place').textContent = place.name + ' · pokład ' + place.deck;
  form.querySelector('[data-action="pickMeetingPlace"]').innerHTML = icon('pin') + 'Zmień miejsce';
  form.querySelector('.form-error').hidden = true;
  dialog.close();
});

function openChat(id, newMatch = false) {
  const person = board.profiles?.find(profile => profile.match && profile.id === id);
  if (!person || offline || dialog.open) return;
  const sender = board.user.id;
  showResult(newMatch ? 'Macie dopasowanie!' : 'Czat z ' + escape(person.name),
    (newMatch ? '<p>Ty i <strong>' + escape(person.name) + '</strong> chcecie się poznać.</p>' : '') +
    '<div class="chat-log" role="log" aria-label="Historia wiadomości"></div>' +
    form('sendMessage', textarea('Wiadomość', 'message', '', 'maxlength="500" required'), submit('Wyślij')));
  const log = dialog.querySelector('.chat-log');
  const chatForm = dialog.querySelector('form');
  const send = chatForm.querySelector('button[type=submit]');
  const failure = chatForm.querySelector('.form-error');
  let lastMessage;
  let loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    try {
      const {messages} = await request(null, '?chat=' + encodeURIComponent(id));
      const latest = messages.at(-1)?.id || '';
      if (!log.isConnected || latest === lastMessage) return;
      lastMessage = latest;
      log.innerHTML = messages.length ? messages.map(message => '<article class="chat-message' +
        (message.from === sender ? ' own' : '') + '"><small>' + (message.from === sender ? 'Ty' : escape(person.name)) +
        ' · ' + new Date(message.at).toLocaleString('pl-PL', {dateStyle: 'short', timeStyle: 'short'}) +
        '</small><p>' + escape(message.text) + '</p></article>').join('') : '<p>Wyślij pierwszą wiadomość.</p>';
      log.scrollTop = log.scrollHeight;
    } catch (error) {
      if (error.status === 404 && log.isConnected) {
        log.textContent = error.message;
        send.disabled = true;
        clearInterval(chatPoll);
      }
    } finally { loading = false; }
  }
  chatForm.addEventListener('submit', event => {
    event.preventDefault();
    if (send.disabled) return;
    send.disabled = true;
    failure.hidden = true;
    void request({action: 'sendMessage', id, message: chatForm.elements.message.value}).then(() => {
      chatForm.reset();
      return load();
    }).catch(error => {
      failure.textContent = error.status ? error.message : 'Połącz się z internetem, aby wysłać wiadomość.';
      failure.hidden = false;
    }).finally(() => { send.disabled = false; });
  });
  void load();
  chatPoll = setInterval(load, 3500);
}

async function mutate(payload, {message, after, onError} = {}) {
  if (operation) return;
  operation = true;
  requestVersion++;
  try {
    const result = await request(payload);
    const {print, plannerCode, plannerEmail, addedCabins, eventId, ...next} = result;
    writeLocal(logoutKey, null);
    updateBoard(next);
    if (after) after(eventId);
    render();
    if (addedCabins) announce('Dodane kabiny: ' + addedCabins + '.');
    else if (message) announce(message);
    if (print) showResult('Zaproszenie do kabiny', '<div class="qr-print"><h3>' + escape(print.voyage) +
      '</h3><p>Kabina ' + escape(print.cabin) + '</p><img width="250" height="250" alt="Kod QR do rejestracji" src="' +
      escape(print.image) + '"><p>Zeskanuj, aby dołączyć do rejsu.</p><a href="' + escape(print.url) + '">' +
      escape(print.url) + '</a></div>', '<button type="button" class="button primary" data-print>Drukuj</button>');
    if (plannerCode) showResult('Dostęp plannera', '<p>Przekaż plannerowi e-mail i kod.</p><p>' + escape(plannerEmail) +
      '</p><p><strong class="access-code">' + escape(plannerCode) + '</strong></p>');
  } catch (error) {
    const message = error.status ? error.message : 'Brak połączenia. Spróbuj ponownie online.';
    if (onError) onError(message);
    else {
      announce(message);
      if ([401, 403, 409].includes(error.status)) setTimeout(() => { void refresh(true); }, 0);
    }
  } finally { operation = false; }
}

content.addEventListener('submit', event => {
  const element = event.target.closest('form[data-form]');
  if (!element) return;
  event.preventDefault();
  if (operation) return;
  const data = Object.fromEntries(new FormData(element));
  const action = element.dataset.form;
  const formError = element.querySelector('.form-error');
  const payload = {action, ...data};
  if (action === 'register') payload.token = route().token;
  if (action === 'addCabins') {
    payload.voyageId = board.voyage.id;
    payload.capacity = Number(data.capacity);
  }
  if (action === 'saveEvent') {
    payload.id = element.dataset.id;
    payload.revision = Number(element.dataset.revision);
    payload.capacity = data.capacity ? Number(data.capacity) : null;
    payload.publish = event.submitter?.value !== 'draft';
  }
  if (action === 'saveGuestEvent') {
    if (!data.placeId) {
      formError.textContent = 'Wybierz miejsce z mapy statku.';
      formError.hidden = false;
      element.querySelector('[data-action="pickMeetingPlace"]').focus();
      return;
    }
    Object.assign(payload, {id: element.dataset.id, revision: Number(element.dataset.revision),
      localTime: data.date + 'T' + data.time});
  }
  if (action === 'profile') payload.visible = data.visible === 'on';
  const buttons = [...element.querySelectorAll('button[type=submit]')];
  buttons.forEach(control => { control.disabled = true; });
  formError.hidden = true;
  const after = {
    login: () => navigate(route().token && board.user?.role === 'guest' && !board.user.cabin ?
      'rejestracja?kod=' + encodeURIComponent(route().token) : 'wydarzenia'),
    register: () => navigate('wydarzenia'),
    saveEvent: () => navigate(board.user.role === 'admin' ? 'admin' : 'planner'),
    saveGuestEvent: id => navigate('wydarzenie/' + id)
  }[action];
  const messages = {createVoyage: 'Utworzono rejs.', profile: 'Zapisano profil.',
    saveEvent: payload.publish ? 'Zapisano opublikowane wydarzenie.' : 'Zapisano szkic.',
    saveGuestEvent: payload.id ? 'Zapisano zmiany w spotkaniu.' : 'Opublikowano spotkanie.'};
  void mutate(payload, {after, message: messages[action], onError: message => {
    formError.textContent = message;
    formError.hidden = false;
  }}).finally(() => buttons.forEach(control => { control.disabled = false; }));
});

async function logout() {
  requestVersion++;
  writeLocal(cacheKey, null);
  writeLocal(logoutKey, 'pending');
  updateBoard({user: null});
  navigate('logowanie');
  render();
  try {
    await request({action: 'logout'});
    if (!board.user) writeLocal(logoutKey, 'done');
  } catch { /* The local marker clears the server session on reconnect. */ }
}

content.addEventListener('click', event => {
  const control = event.target.closest('button[data-action]');
  if (!control || operation) return;
  const {action, id} = control.dataset;
  const localActions = {
    today: () => { day = todayDate(); month = day.slice(0, 7); },
    day: () => { day = id; month = day.slice(0, 7); },
    month: () => {
      const date = new Date(month + '-01T12:00Z');
      date.setUTCMonth(date.getUTCMonth() + Number(id));
      month = date.toISOString().slice(0, 7);
      day = month + '-01';
    },
    bookings: () => { filter = id; },
    adminTab: () => { adminTab = id; archiveId = ''; },
    archive: () => { archiveId = id; adminTab = 'events'; }
  };
  if (localActions[action]) {
    localActions[action]();
    render();
    const matching = [...content.querySelectorAll('button[data-action]')].find(item =>
      item.dataset.action === action && item.dataset.id === id);
    (matching || content.querySelector('h1'))?.focus({preventScroll: true});
    return;
  }
  if (action === 'logout') return void logout();
  if (offline) return;
  if (action === 'pickMeetingPlace') return openMeetingMap(control);
  if (action === 'chat') return openChat(id);
  const confirms = {
    resetMatches: 'Usunąć wszystkie Twoje polubienia, pominięcia i dopasowania? Wiadomości zostaną zachowane.',
    closeVoyage: 'Zakończyć rejs? Kody QR przestaną działać.',
    revokeQr: 'Unieważnić QR tej kabiny?',
    cancelEvent: 'Odwołać to wydarzenie?',
    resetPlannerCode: 'Wystawić nowy kod dla tego plannera?',
    togglePlanner: control.dataset.active === 'false' ? 'Dezaktywować konto plannera?' : '',
    issueQr: control.dataset.replace === 'true' ? 'Odnowić QR i unieważnić poprzedni?' : ''
  };
  if (confirms[action] && !window.confirm(confirms[action])) return;
  const payload = ['skip', 'connect'].includes(action) ? {action: 'choose', id, choice: action} :
    {action, id, ...(action === 'togglePlanner' && {active: control.dataset.active === 'true'})};
  const messages = {resetMatches: 'Usunięto historię dopasowań.', join: 'Zapisano na wydarzenie.', leave: 'Wypisano z wydarzenia.', closeVoyage: 'Rejs zakończony.',
    cancelEvent: 'Wydarzenie odwołane.', togglePlanner: 'Zapisano status konta.', revokeQr: 'Kod QR unieważniony.'};
  void mutate(payload, {message: messages[action], after: action === 'connect' ? () => openChat(id, true) : undefined})
    .then(() => {
      if ((action === 'join' || action === 'leave') && !control.isConnected && document.activeElement === document.body) {
        content.querySelector(`button[data-id="${CSS.escape(id)}"][data-action="join"], button[data-id="${CSS.escape(id)}"][data-action="leave"]`)
          ?.focus({preventScroll: true});
      }
    });
});

let swipe;
content.addEventListener('pointerdown', event => {
  const person = event.target.closest('.person-card');
  if (!person || event.target.closest('button') || !event.isPrimary || event.button !== 0) return;
  person.setPointerCapture(event.pointerId);
  swipe = {person, id: event.pointerId, x: event.clientX, y: event.clientY};
});
content.addEventListener('pointermove', event => {
  if (swipe?.id !== event.pointerId) return;
  const x = event.clientX - swipe.x;
  if (Math.abs(x) > Math.abs(event.clientY - swipe.y)) swipe.person.style.translate = Math.max(-36, Math.min(36, x / 2)) + 'px';
});
function stopSwipe(event) {
  if (swipe?.id !== event.pointerId) return;
  const {person, x, y} = swipe;
  swipe = null;
  person.style.translate = '';
  const offset = event.clientX - x;
  if (event.type === 'pointerup' && Math.abs(offset) > 55 && Math.abs(offset) > Math.abs(event.clientY - y) * 1.5) {
    person.querySelector('[data-action="' + (offset > 0 ? 'connect' : 'skip') + '"]')?.click();
  }
}
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) content.addEventListener(name, stopSwipe);

function initRoute() {
  if (route().page === 'rejestracja') void loadInvite(route().token);
  else render(true);
}
function onlineRefresh() {
  if (route().page === 'rejestracja' && invite?.error) void loadInvite(route().token);
  void refresh();
}
if (apiBase && new URL(apiBase).origin !== location.origin) {
  location.replace(new URL('/' + location.hash, apiBase));
} else {
  document.querySelector('.skip-link').addEventListener('click', event => {
    event.preventDefault();
    content.focus();
  });
  window.addEventListener('hashchange', initRoute);
  window.addEventListener('online', onlineRefresh);
  window.addEventListener('offline', () => { void refresh(true); });
  window.addEventListener('storage', event => {
    if (event.key === logoutKey && event.newValue) {
      requestVersion++;
      updateBoard({user: null});
      navigate('logowanie');
    }
  });
  window.addEventListener('focus', () => {
    if (!content.querySelector('form') && !dialog.open) onlineRefresh();
  });
  setInterval(() => {
    if (!document.hidden && ['wydarzenia', 'kalendarz', 'moje-zapisy', 'wydarzenie', 'poznaj', 'planner', 'admin'].includes(route().page) &&
        !content.querySelector('form:focus-within') && !dialog.open) void refresh();
  }, 15000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (readLocal(logoutKey)) board = {user: null};
  initRoute();
  void refresh(true);
}
