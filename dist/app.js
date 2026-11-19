const genderFilters = {all: 'Wszystkich', women: 'Kobiety', men: 'Mężczyzn'};
const datingIntents = {dates: 'Randki', relationship: 'Związek', friendship: 'Znajomości', activities: 'Wspólne aktywności'};
const interestKey = interest => interest.trim().toLocaleLowerCase('pl');
const discoveryFilters = () => state.discoveryFilters?.[state.member] ?? {};
const profileIntent = profile => profile.intent || '';
function matchesDiscoveryFilters(profile) {
  const {intent, interest} = discoveryFilters();
  return matchesPreference(profile) && (!intent || profileIntent(profile) === intent) &&
    (!interest || profile.interests.some(item => interestKey(item) === interest));
}
const preferredGender = () => state.crewPreferences?.[state.member] ?? 'all';
const matchesPreference = profile => preferredGender() === 'all' || profile.gender === preferredGender();
const storageKey = 'crewconnect-v1';
let sharedEvents = [];
let eventsAvailable = false;
const isShared = event => sharedEvents.some(shared => shared.id === event.id);
const allEvents = () => [...sharedEvents, ...state.events.filter(event => !isShared(event))];

async function refreshEvents() {
  try {
    const response = await fetch('api/events', {cache: 'no-store'});
    if (!response.ok) return;
    const events = await response.json();
    if (!Array.isArray(events)) return;
    const changed = !eventsAvailable || JSON.stringify(sharedEvents) !== JSON.stringify(events);
    eventsAvailable = true;
    sharedEvents = events;
    if (changed) render();
  } catch {
    // Preserve the last loaded board while offline.
  }
}

async function updateSharedEvent(payload, success) {
  try {
    const response = await fetch('api/events', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
    });
    const result = await response.json();
    await refreshEvents();
    announce(response.ok ? success : result.error);
  } catch {
    announce('Nie udało się zapisać na tablicy pokładowej. Spróbuj ponownie po odzyskaniu połączenia.');
  }
}
const publishEvent = event => updateSharedEvent({
  ...event, capacity: event.capacity ?? 30, action: 'publish', displayName: personalName(event.owner)
}, 'Wydarzenie jest widoczne na tablicy pokładowej.');
const pendingKey = 'crewconnect-workspace-pending';
const logoutKey = 'crewconnect-session-ended';
const apiBase = document.querySelector('meta[name="crewconnect-api"]')?.content;
const workspaceUrl = apiBase ? new URL('/api/workspace', apiBase).href : 'api/workspace';
const tokenKey = 'crewconnect-workspace-token:' + workspaceUrl;
let syncing;
let changingProfileSession = false;

async function syncWorkspace() {
  if (syncing) return syncing;
  if (!navigator.onLine || changingProfileSession) return;
  syncing = performWorkspaceSync();
  try {
    await syncing;
  } finally {
    syncing = undefined;
  }
}

async function performWorkspaceSync() {
  try {
    let token = localStorage.getItem(tokenKey);
    const headers = () => token ? {Authorization: 'Bearer ' + token} : {};
    const response = await fetch(workspaceUrl, {cache: 'no-store', headers: headers()});
    if (response.status === 403 && !apiBase) {
      resetProfileSession();
      announce('Konto jest niedostępne. Skontaktuj się z administratorem.');
      return;
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
    const issuedToken = response.headers.get('X-Workspace-Token');
    if (issuedToken) {
      token = issuedToken;
      localStorage.setItem(tokenKey, token);
    }
    const snapshot = await response.json();
    let pending = localStorage.getItem(pendingKey);
    if (!pending && snapshot) {
      state = snapshot;
      localStorage.setItem(storageKey, JSON.stringify(state));
      render();
    }
    if (!pending && !snapshot) pending = localStorage.getItem(storageKey);
    while (pending) {
      const result = await fetch(workspaceUrl, {
        method: 'PUT', headers: {...headers(), 'Content-Type': 'application/json'}, body: pending
      });
      if (!result.ok) return;
      const latest = localStorage.getItem(pendingKey);
      if (latest === pending) localStorage.removeItem(pendingKey);
      pending = latest === pending ? null : latest;
    }
  } catch {
    // A later save, reload or reconnect retries the locally stored changes.
  }
}
const dateValue = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return calendarDate(date);
};
function calendarDate(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
const initial = {member: '', events: [], reports: []};
let state = JSON.parse(localStorage.getItem(storageKey) || 'null') || initial;
const content = document.querySelector('#content');
const dialog = document.querySelector('#dialog');
const member = document.querySelector('#crew');
const notice = document.querySelector('#notice');
let noticeTimer;
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const profileId = profile => profile.id ?? profile.name;
const initials = name => name.split(/\s+/u).slice(0, 2).map(part => [...part][0]).join('').toLocaleUpperCase('pl');
const personalName = id => state.userProfile?.id === id ? state.userProfile?.name : undefined;
const displayName = (id, names) => personalName(id) ?? (names && Object.hasOwn(names, id) ? names[id] : id);

function activatePersonalProfile() {
  state.member = state.userProfile?.id ?? '';
  member.textContent = state.userProfile?.name ?? 'Dodaj mój profil';
}

const formatDate = value => new Intl.DateTimeFormat('pl-PL', {
  weekday: 'short', day: 'numeric', month: 'short',
  ...(value.includes('T') ? {hour: '2-digit', minute: '2-digit'} : {})
}).format(new Date(value.includes('T') ? value : value + 'T12:00'));
const participants = event => Object.keys(event.votes);
const isFull = event => Number.isInteger(event.capacity) && participants(event).length >= event.capacity;
function signupButton(event, style) {
  if (!state.userProfile) return '<a href="#profil">Dodaj profil, aby się zapisać</a>';
  const joined = Boolean(event.votes[state.member]);
  const full = !joined && isFull(event);
  const label = joined ? 'Zmień dostępność' : full ? 'Brak miejsc' : 'Zapisz się';
  return `<button class="${style}" data-action="vote" data-id="${event.id}" ${full ? 'disabled' : ''}>${label}</button>`;
}
const sharedSlots = event => participants(event).length < 2 ? [] : event.slots.filter(
  (_, index) => Object.values(event.votes).every(vote => vote.includes(index))
).sort();
let selectedDay = dateValue();
let visibleMonth = selectedDay.slice(0, 7);
const monthLabel = new Intl.DateTimeFormat('pl-PL', {month: 'long', year: 'numeric'});
const dayLabel = new Intl.DateTimeFormat('pl-PL', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});

function renderCalendar() {
  const first = new Date(visibleMonth + '-01T12:00');
  const start = new Date(first);
  start.setDate(1 - (first.getDay() + 6) % 7);
  const scheduled = sharedEvents.flatMap(event => {
    const [agreedSlot] = sharedSlots(event);
    const slots = agreedSlot ? [agreedSlot] : event.slots;
    return slots.map(slot => ({event, slot, agreed: Boolean(agreedSlot)}));
  }).sort((a, b) => a.slot.localeCompare(b.slot));
  const eventsOn = day => scheduled.filter(item => item.slot.slice(0, 10) === day);
  const today = dateValue();
  const cells = Array.from({length: 42}, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const day = calendarDate(date);
    const items = eventsOn(day);
    return `<button class="calendar-day ${day.startsWith(visibleMonth) ? '' : 'outside'}" data-action="calendar-day" data-day="${day}"
      aria-label="${dayLabel.format(date)}, wydarzenia: ${items.length}" aria-pressed="${day === selectedDay}" ${day === today ? 'aria-current="date"' : ''}>
      <span class="day-number">${date.getDate()}</span>
      ${items.slice(0, 2).map(({event, slot, agreed}) => `<span class="calendar-event${agreed ? '' : ' proposed'}">${slot.slice(11, 16)} ${escape(event.title)}</span>`).join('')}
      ${items.length > 2 ? `<span class="calendar-more">+${items.length - 2}</span>` : ''}
    </button>`;
  }).join('');
  const agenda = eventsOn(selectedDay).map(({event, slot, agreed}) => `
    <article class="agenda-item"><time datetime="${slot}">${slot.slice(11, 16)}</time>
      <div><h3>${escape(event.title)}</h3><p class="muted">${agreed ? 'Uzgodniony termin' : 'Proponowany termin'} · ${escape(displayName(event.owner, event.memberNames))}</p></div>
      ${signupButton(event, 'secondary')}
    </article>`).join('');
  return `<section class="calendar" aria-labelledby="calendar-title">
    <header class="calendar-header"><div><h1 id="calendar-title">Kalendarz rejsu</h1><h2>${monthLabel.format(first)}</h2></div>
      <div class="calendar-controls">
        <button class="secondary" data-action="calendar-today">Dzisiaj</button>
        <button class="secondary" data-action="calendar-prev" aria-label="Poprzedni miesiąc">‹</button>
        <button class="secondary" data-action="calendar-next" aria-label="Następny miesiąc">›</button>
      </div>
    </header>
    <div class="calendar-grid">${['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'].map(day => `<span class="weekday">${day}</span>`).join('')}${cells}</div>
  </section>
  <section class="card agenda"><header><h2>${dayLabel.format(new Date(selectedDay + 'T12:00'))}</h2>
    ${state.userProfile ? `<button class="primary" data-action="event" data-day="${selectedDay}">+ Nowa aktywność</button>` : '<a href="#profil">Dodaj profil, aby zaplanować aktywność</a>'}</header>
    ${agenda || `<p class="muted">${eventsAvailable ? 'Tego dnia nie ma wspólnych aktywności.' : 'Oczekiwanie na wspólną tablicę wydarzeń.'}</p>`}
  </section>`;
}
const stat = (count, label) => `<div class="stat"><b>${count}</b><span>${label}</span></div>`;
const title = (eyebrow, heading, description, action, label) => `
  <section class="hero"><div><span class="eyebrow">${eyebrow}</span><h1>${heading}</h1><p>${description}</p></div>
  ${action ? `<button class="primary" data-action="${action}">+ ${label}</button>` : ''}</section>`;

function eventCard(event) {
  const people = participants(event);
  const shared = sharedSlots(event);
  const summary = shared.length ? 'Wspólny termin: ' + formatDate(shared[0]) :
    people.length < 2 ? 'Potrzeba co najmniej dwóch uczestników.' : 'Brak wspólnego terminu.';
  return `<article class="card" data-event-card="${escape(event.id)}" tabindex="-1">
    <span class="badge">${escape(event.type)}</span>
    <h3>${escape(event.title)}</h3>
    <p class="muted">Organizuje ${escape(displayName(event.owner, event.memberNames))}</p>
    ${event.description ? `<p>${escape(event.description)}</p>` : ''}
    <p class="note"><strong>${summary}</strong></p>
    <p class="muted">${people.length}${event.capacity ? ' / ' + event.capacity : ''} zapisanych${people.length ? ' · ' + escape(people.map(id => displayName(id, event.memberNames)).join(', ')) : ''}</p>
    <footer>${signupButton(event, 'primary')}
    ${isShared(event) ? '<span class="badge">Tablica pokładowa</span>' : eventsAvailable && event.id !== 'fifa' && event.owner === state.member ? `<button class="secondary" data-action="publish" data-id="${event.id}">Opublikuj na tablicy</button>` : ''}
    ${event.votes[state.member] && event.owner !== state.member ? `<button class="secondary" data-action="leave" data-id="${event.id}">Wypisz się</button>` : ''}</footer>
  </article>`;
}

const profileName = profile => escape(profile.name) + (profile.age ? `, ${escape(profile.age)}` : '');

function profileDetails(profile, sharedInterests = [], showName = true) {
  const intent = datingIntents[profileIntent(profile)];
  const tags = profile.interests.map(interest => {
    const common = sharedInterests.includes(interestKey(interest));
    return `<span${common ? ' class="common-interest"' : ''}>${common ? '✓ ' : ''}${escape(interest)}</span>`;
  }).join('');
  return `${showName ? `<h2>${profileName(profile)}</h2>` : ''}
    ${profile.role ? `<p class="muted">${escape(profile.role)}</p>` : ''}
    ${profile.bio ? `<p class="profile-bio">${escape(profile.bio)}</p>` : ''}
    ${intent ? `<p class="profile-intent">Szukam: <strong>${intent}</strong></p>` : ''}
    ${tags ? `<div class="crew-interests">${tags}</div>` : ''}
    ${profile.icebreaker ? `<p class="note"><strong>Zacznijmy od pytania</strong><br>${escape(profile.icebreaker)}</p>` : ''}`;
}

function renderUserProfile() {
  const profile = state.userProfile;
  const details = profile ? profileDetails(profile, [], false) : '<p class="muted">Wybierz nazwę i dodaj kilka słów o sobie.</p>';
  return renderMyProfile({
    name: profile ? profileName(profile) : 'Przedstaw się innym',
    avatar: profile ? escape(initials(profile.name)) : '',
    details: `${details}<p class="muted">Tego profilu używasz przy aktywnościach, rezerwacjach i w „Poznaj ludzi”. Po opublikowaniu zmiany z tego formularza pojawiają się też na Twojej karcie.</p>`,
    actions: `<button class="primary" data-action="profile-edit">${profile ? 'Edytuj profil' : 'Utwórz profil'}</button>
      ${apiBase ? '' : profile ? '<button class="secondary" data-action="profile-logout">Wyloguj się</button>' :
        '<button class="secondary" data-action="profile-login">Zaloguj się</button>'}`,
    administrationHref: adminKey ? '#administracja' : ''
  });
}

let onlineDiscovery;
let discoveryLoading = false;
let onlineError = '';
let onlineSearch = '';
const skippedOnline = new Set();
const personalDiscovery = () => Boolean(state.userProfile);
const onlinePeer = id => onlineDiscovery?.profiles.find(profile => profile.id === id);

async function discoveryRequest(payload, peer) {
  const query = peer ? '?peer=' + encodeURIComponent(peer) : '';
  const options = payload ? {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
  } : {cache: 'no-store'};
  const response = await fetch('api/connections' + query, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Nie udało się połączyć z czatem.');
  return result;
}

async function refreshDiscovery() {
  if (!personalDiscovery() || discoveryLoading || location.hash !== '#zaloga') return;
  discoveryLoading = true;
  try {
    const next = await discoveryRequest();
    const match = onlineDiscovery?.published && next.matches.find(id =>
      !onlineDiscovery.matches.includes(id) && next.profiles.some(profile => profile.id === id));
    const changed = onlineError || JSON.stringify(onlineDiscovery) !== JSON.stringify(next);
    onlineError = '';
    onlineDiscovery = next;
    if (personalDiscovery() && location.hash === '#zaloga') {
      if (changed) render();
      if (pendingNotificationChat) startNotificationChat();
      else if (match && !dialog.open) openCrewChat(match, true);
    }
  } catch (error) {
    if (onlineError !== error.message) {
      onlineError = error.message;
      if (personalDiscovery() && location.hash === '#zaloga') render();
    }
  } finally {
    discoveryLoading = false;
  }
}

function renderDiscoveryCard(profile, commonInterests) {
  const id = escape(profileId(profile));
  return `<div class="swipe-deck">
    <article class="crew-card swipe-card" id="crew-card" data-profile="${id}">
      <div class="crew-portrait ${profile.color || 'plum'}">
        ${profile.example ? '<span class="swipe-example">Profil przykładowy</span>' : ''}
        <span class="swipe-initials" aria-hidden="true">${escape(profile.initials || initials(profile.name))}</span>
        <strong class="swipe-stamp swipe-like" aria-hidden="true">Chcę poznać</strong>
        <strong class="swipe-stamp swipe-pass" aria-hidden="true">Pomijam</strong>
      </div>
      <div class="crew-details">${profileDetails(profile, commonInterests)}${profile.example ? '<p class="muted">Ta karta służy do wypróbowania gestów i nie odpowiada na wiadomości.</p>' : ''}</div>
    </article>
  </div>
  <div class="crew-actions swipe-actions" aria-label="Wybierz reakcję">
    <button type="button" class="swipe-choice" data-action="crew-skip" data-profile="${id}">
      <span class="swipe-choice-icon" aria-hidden="true">×</span>Pomiń</button>
    <button type="button" class="swipe-choice" data-action="crew-connect" data-profile="${id}">
      <span class="swipe-choice-icon" aria-hidden="true">♥</span>Chcę poznać</button>
  </div>
  <p class="crew-hint muted">Przesuń kartę w lewo lub w prawo albo użyj przycisków.</p>`;
}

function renderOnlineDiscovery() {
  const heading = '<header class="crew-heading"><h1>Poznaj ludzi na pokładzie</h1>' +
    '<div class="crew-filter"><button class="primary" data-action="online-profile-edit">Edytuj mój profil</button>' +
    '<button class="secondary" data-action="online-reset">Usuń historię dopasowań</button></div></header>';
  const error = onlineError ? `<p class="form-error" role="status">${escape(onlineError)}</p>` : '';
  if (!onlineDiscovery) return heading + (error || '<p>Ładowanie profili online…</p>');
  if (!onlineDiscovery.published) return heading + `<div class="card"><h2>Opublikuj swój profil</h2>
    <p>Osoby korzystające z CrewConnect zobaczą Twoją nazwę, opis, zainteresowania i intencje. Czat otwiera się po obustronnym polubieniu.</p>
    <button class="primary" data-action="online-publish">Opublikuj profil</button></div>${error}`;
  const profiles = [...onlineDiscovery.profiles].sort((first, second) => Boolean(first.example) - Boolean(second.example));
  const filters = discoveryFilters();
  const options = values => Object.entries(values).map(([value, label]) =>
    `<option value="${value}" ${filters.intent === value ? 'selected' : ''}>${label}</option>`).join('');
  const interests = new Map(profiles.flatMap(profile => profile.interests.map(item => [interestKey(item), item])));
  const query = interestKey(onlineSearch);
  const candidates = query ? profiles.filter(profile => interestKey(profile.name).includes(query)) :
    profiles.filter(profile => matchesDiscoveryFilters(profile) && !skippedOnline.has(profile.id));
  const candidate = candidates.find(profile => !onlineDiscovery.liked.includes(profile.id));
  const waiting = query && candidates.some(profile => onlineDiscovery.liked.includes(profile.id) && !onlineDiscovery.matches.includes(profile.id));
  const matches = profiles.filter(profile => onlineDiscovery.matches.includes(profile.id));
  const card = candidate ? renderDiscoveryCard(candidate, state.userProfile.interests.map(interestKey)) :
    `<div class="card crew-empty"><h2>${waiting ? 'Wysłano polubienie' : 'Brak nowych profili online'}</h2>
      <p>${waiting ? 'Dopasowanie pojawi się, gdy druga osoba również kliknie „Chcę poznać”.' : 'Sprawdź nazwę, zmień filtry lub poproś drugą osobę o opublikowanie profilu.'}</p></div>`;
  return heading + error + `
    <form class="crew-filter crew-search" id="online-people-search">
      <label for="online-name">Znajdź osobę po nazwie</label>
      <input id="online-name" type="search" name="name" maxlength="80" value="${escape(onlineSearch)}">
      <button class="primary" type="submit">Szukaj</button>
      ${onlineSearch ? '<button class="secondary" type="button" data-action="online-clear-search">Wyczyść</button>' : ''}
    </form>
    <div class="crew-filter">
    <label for="crew-gender">Kogo chcesz poznawać?</label><select id="crew-gender">
      ${Object.entries(genderFilters).map(([value, label]) => `<option value="${value}" ${preferredGender() === value ? 'selected' : ''}>${label}</option>`).join('')}
    </select>
    <label for="crew-intent">Intencje</label><select id="crew-intent"><option value="">Dowolne</option>${options(datingIntents)}</select>
    <label for="crew-interest">Zainteresowanie</label><select id="crew-interest"><option value="">Dowolne</option>
      ${[...interests].sort((a,b) => a[1].localeCompare(b[1], 'pl')).map(([value,label]) =>
        `<option value="${escape(value)}" ${filters.interest === value ? 'selected' : ''}>${escape(label)}</option>`).join('')}
    </select>
    </div><div class="crew-filter">
    <button class="secondary" data-action="online-publish">Zaktualizuj profil online</button>
    <button class="secondary" data-action="online-hide">Ukryj profil online</button>
    ${skippedOnline.size ? '<button class="secondary" data-action="online-revisit">Pokaż pominięte</button>' : ''}
    </div><div class="crew-layout"><section aria-label="Profile online">${card}</section>
    <aside class="card crew-matches"><h2>Dopasowania online</h2>${matches.map(profile => `<div class="crew-match">
      <strong>${escape(profile.name)}</strong>
      <button class="secondary" data-action="crew-chat" data-profile="${profile.id}" aria-label="Otwórz czat z ${escape(profile.name)}">Czat</button>
      </div>`).join('') || '<p class="muted">Czekamy na obustronne polubienie.</p>'}</aside></div>`;
}

async function updateOnlineDiscovery(payload, message) {
  try {
    await discoveryRequest(payload);
    await refreshDiscovery();
    if (message) announce(message);
  } catch (error) {
    announce(error.message);
  }
}

function renderCrew() {
  if (personalDiscovery()) return renderOnlineDiscovery();
  return `<header class="crew-heading"><h1>Poznaj ludzi na pokładzie</h1></header>
    <section class="card crew-empty"><h2>Stwórz swój profil</h2>
      <p>Załóż profil, żeby poznawać osoby podczas rejsu.</p>
      <button class="primary" data-action="online-profile-edit">+ Dodaj nowy profil</button>
    </section>`;
}

const chatTime = new Intl.DateTimeFormat('pl-PL', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

function openCrewChat(profile, celebrate = false) {
  const peerName = onlinePeer(profile)?.name;
  if (!personalDiscovery() || !onlineDiscovery?.matches.includes(profile) || !peerName || dialog.open) return;
  const name = escape(peerName);
  const author = onlineDiscovery.me;
  dialog.classList.add('crew-chat-dialog');
  dialog.innerHTML = `
    <div class="dialog-head"><h2 id="dialog-title">${celebrate ? 'Macie dopasowanie!' : 'Czat z ' + name}</h2>
      <button type="button" data-close class="secondary" aria-label="Zamknij czat">✕</button></div>
    <div class="match-celebration" ${celebrate ? '' : 'hidden'}>
      <div class="match-hearts" aria-hidden="true"><span>♥</span><span>♥</span><span>♥</span><span>♥</span><span>♥</span></div>
      <p>Ty i <strong>${name}</strong> chcecie się poznać.</p>
      <button type="button" class="primary" data-start-chat>Otwórz czat</button>
    </div>
    <div data-chat ${celebrate ? 'hidden' : ''}>
      <div class="chat-messages" role="log" aria-label="Historia wiadomości"></div>
      <p class="chat-typing" role="status"></p>
      <form class="chat-compose">
        <div class="chat-edit" hidden><strong>Edytujesz wiadomość</strong><button type="button" class="secondary" data-chat-cancel>Anuluj</button></div>
        <label>Wiadomość <textarea name="message" rows="2" maxlength="500" required aria-describedby="chat-shortcuts"></textarea></label>
        <div class="chat-toolbar">
          <button type="button" class="secondary" data-emoji-toggle aria-expanded="false" aria-controls="chat-emoji">😊 Emoji</button>
          <button type="submit" class="primary">Wyślij</button>
        </div>
        <div class="chat-emoji" id="chat-emoji" aria-label="Wybierz emoji" hidden>
          ${['😀','😂','🥰','😍','😉','😎','🙌','👍','♥️','🔥','🎉','⚓','🌊','☕','🎮','💬'].map(emoji =>
            `<button type="button" data-emoji="${emoji}">${emoji}</button>`).join('')}
        </div>
        <small class="muted" id="chat-shortcuts">Enter wysyła. Shift + Enter dodaje nową linię.</small>
      </form>
    </div>`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  const history = dialog.querySelector('.chat-messages');
  const form = dialog.querySelector('.chat-compose');
  const input = form.elements.message;
  const submit = form.querySelector('[type=submit]');
  const typing = dialog.querySelector('.chat-typing');
  const emojiToggle = form.querySelector('[data-emoji-toggle]');
  const emojiPanel = form.querySelector('.chat-emoji');
  let remoteMessages = [];
  let editing;
  let draft = '';
  let lastTyping = 0;
  let typingActive = false;

  function setEmojiPanel(open) {
    emojiPanel.hidden = !open;
    emojiToggle.setAttribute('aria-expanded', String(open));
  }

  function updateTyping(active) {
    const now = Date.now();
    if (active && now - lastTyping < 2200) return;
    if (!active && !typingActive) return;
    typingActive = active;
    lastTyping = active ? now : 0;
    void discoveryRequest({action: 'typing', peer: profile, active}).catch(() => {});
  }

  function renderMessages() {
    const nearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 70;
    const focused = history.contains(document.activeElement) ? document.activeElement : null;
    const focusedId = focused?.dataset.chatId;
    const focusedAction = focused?.dataset.chatAction;
    history.innerHTML = remoteMessages.map(message => {
      const own = message.sender === author;
      return `<article class="chat-message${own ? ' own' : ''}${message.deletedAt ? ' removed' : ''}">
        <span class="chat-meta">${own ? 'Ty' : name} · ${chatTime.format(new Date(message.at))}${!message.deletedAt && message.editedAt ? ' · Edytowano' : ''}</span>
        <p>${message.deletedAt ? 'Wiadomość usunięta' : escape(message.text)}</p>
        ${own && !message.deletedAt ? `<div class="chat-message-actions">
          <button type="button" data-chat-action="edit" data-chat-id="${escape(message.id)}">Edytuj</button>
          <button type="button" data-chat-action="delete" data-chat-id="${escape(message.id)}">Usuń</button>
        </div>` : ''}
      </article>`;
    }).join('') || '<p class="muted">Wyślij pierwszą wiadomość.</p>';
    if (nearBottom) history.scrollTop = history.scrollHeight;
    if (focusedId) [...history.querySelectorAll('[data-chat-id]')].find(button =>
      button.dataset.chatId === focusedId && button.dataset.chatAction === focusedAction)?.focus({preventScroll: true});
  }

  function closeEdit() {
    editing = undefined;
    form.querySelector('.chat-edit').hidden = true;
    submit.textContent = 'Wyślij';
    input.value = draft;
    draft = '';
    input.focus();
  }

  form.querySelector('[data-chat-cancel]').onclick = () => { if (!submit.disabled) closeEdit(); };
  emojiToggle.onclick = () => setEmojiPanel(emojiPanel.hidden);
  emojiPanel.onclick = event => {
    const emoji = event.target.closest('[data-emoji]')?.dataset.emoji;
    if (!emoji) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (input.value.length - (end - start) + emoji.length > input.maxLength) return;
    input.setRangeText(emoji, start, end, 'end');
    setEmojiPanel(false);
    input.focus();
    updateTyping(true);
  };
  input.addEventListener('input', () => updateTyping(Boolean(input.value.trim())));
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    form.requestSubmit();
  });
  history.onclick = async event => {
    if (submit.disabled) return;
    const button = event.target.closest('[data-chat-action]');
    const message = remoteMessages.find(item => item.id === button?.dataset.chatId && item.sender === author && !item.deletedAt);
    if (!message) return;
    if (button.dataset.chatAction === 'edit') {
      if (!editing) draft = input.value;
      editing = message.id;
      input.value = message.text;
      form.querySelector('.chat-edit').hidden = false;
      submit.textContent = 'Zapisz zmiany';
      input.focus();
      return;
    }
    if (!window.confirm('Usunąć tę wiadomość z rozmowy?')) return;
    button.disabled = true;
    try {
      await discoveryRequest({action: 'deleteMessage', peer: profile, messageId: message.id});
      if (editing === message.id) closeEdit();
      await reloadMessages();
    } catch (error) {
      announce(error.message);
    } finally {
      button.disabled = false;
    }
  };

  const showChat = () => {
    if (!dialog.open || !form.isConnected) return;
    dialog.querySelector('.match-celebration').hidden = true;
    dialog.querySelector('[data-chat]').hidden = false;
    dialog.querySelector('#dialog-title').textContent = 'Czat z ' + peerName;
    renderMessages();
    input.focus();
  };
  let chatLoading = false;
  async function reloadMessages() {
    if (chatLoading || !dialog.open || !form.isConnected) return;
    chatLoading = true;
    try {
      const {messages, peerTyping} = await discoveryRequest(null, profile);
      if (!form.isConnected) return;
      const status = peerTyping ? peerName + ' pisze…' : '';
      if (typing.textContent !== status) typing.textContent = status;
      if (JSON.stringify(messages) !== JSON.stringify(remoteMessages)) {
        remoteMessages = messages;
        renderMessages();
      }
    } catch (error) {
      announce(error.message);
    } finally {
      chatLoading = false;
    }
  }
  const pollChat = setInterval(reloadMessages, 1500);
  form.onsubmit = async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || text.length > 500 || submit.disabled) return;
    submit.disabled = true;
    try {
      await discoveryRequest({action: editing ? 'editMessage' : 'message', peer: profile, messageId: editing, text});
      if (editing) closeEdit();
      else input.value = '';
      updateTyping(false);
      setEmojiPanel(false);
      await reloadMessages();
    } catch (error) {
      announce(error.message);
    } finally {
      submit.disabled = false;
      input.focus();
    }
  };
  dialog.querySelector('[data-start-chat]').onclick = showChat;
  dialog.addEventListener('close', () => {
    clearInterval(pollChat);
    updateTyping(false);
    dialog.classList.remove('crew-chat-dialog');
    [...content.querySelectorAll('[data-action="crew-chat"]')].find(button => button.dataset.profile === profile)?.focus();
  }, {once: true});
  dialog.showModal();
  void reloadMessages();
  if (celebrate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(showChat, 1500);
  else showChat();
}

function chooseCrewProfile(profile, choice) {
  if (!personalDiscovery() || !onlinePeer(profile)) return;
  if (choice === 'connect') void updateOnlineDiscovery({action: 'like', peer: profile});
  else {
    skippedOnline.add(profile);
    onlineSearch = '';
    render();
  }
}

function render() {
  if (location.hash === '#gry') history.replaceState(null, '', '#restauracje');
  if (location.hash === '#konto') history.replaceState(null, '', '#profil');
  const page = location.hash.slice(1);
  const reports = isDutyPage(page);
  document.body.classList.toggle('on-duties', reports);
  const calendar = page === 'kalendarz';
  const discover = page === 'zaloga';
  const profile = page === 'profil';
  const administration = page === 'administracja';
  const restaurants = page === 'restauracje';
  const statistics = page === 'statystyki';
  const map = page === 'mapa';
  const activePage = administration ? 'profil' :
    (calendar || reports || discover || profile || map || restaurants || statistics ? page : 'aktywnosci');
  content.classList.toggle('map-content', map);
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === activePage) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  activatePersonalProfile();
  updateNetwork();
  renderNotifications();
  if (statistics) {
    content.innerHTML = renderShipStatistics();
  } else if (restaurants) {
    content.innerHTML = renderRestaurants();
  } else if (administration) {
    content.innerHTML = renderUserAdministration();
  } else if (map) {
    if (!content.querySelector('.ship-map-frame')) {
      content.innerHTML = '<h1 class="visually-hidden">Mapa statku</h1>' +
        '<iframe class="ship-map-frame" title="Plan pokładów Wonder of the Seas" src="navigation.html?embed=1"></iframe>';
    }
  } else if (profile) {
    content.innerHTML = renderUserProfile();
  } else if (discover) {
    content.innerHTML = renderCrew();
    content.querySelector('h1').tabIndex = -1;
  } else if (calendar) {
    content.innerHTML = renderCalendar();
  } else if (reports) {
    content.innerHTML = state.userProfile ? renderDuties(page) :
      '<section class="card"><h1>Warty i obowiązki</h1><p>Dodaj swój profil, aby korzystać z harmonogramu.</p><a href="#profil">Przejdź do profilu</a></section>';
  } else {
    content.innerHTML = title('Życie na pokładzie', 'Aktywności na pokładzie', 'Zaproponuj wydarzenie i znajdź termin, który pasuje wszystkim zapisanym.', state.userProfile ? 'event' : '', 'Nowa aktywność') +
      `<div class="stats">${stat(allEvents().length, 'Aktywności')}${stat(allEvents().filter(event => event.votes[state.member]).length, 'Moje zapisy')}${stat(allEvents().filter(event => sharedSlots(event).length).length, 'Uzgodnione terminy')}</div>
      <section class="section"><h2>Wydarzenia na pokładzie</h2><div class="grid">${allEvents().map(eventCard).join('') || '<p class="empty">Brak aktywności.</p>'}</div></section>`;
  }
}

function save(message) {
  activatePersonalProfile();
  const snapshot = JSON.stringify(state);
  localStorage.setItem(storageKey, snapshot);
  localStorage.setItem(pendingKey, snapshot);
  void syncWorkspace();
  render();
  if (message) announce(message);
}

function announce(message) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 3500);
}

function openForm(name, fields, submitLabel, onSubmit) {
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${name}</h2><button type="button" data-close class="secondary" aria-label="Zamknij">✕</button></div>
    <form>${fields}<p class="form-error" data-submit-error role="alert" hidden></p><button type="submit" class="primary">${submitLabel}</button></form>`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type=submit]');
    const error = form.querySelector('[data-submit-error]');
    if (submit.disabled) return;
    submit.disabled = true;
    error.hidden = true;
    try {
      if (await onSubmit(new FormData(form), form) !== false && dialog.open && form.isConnected) dialog.close();
    } catch (failure) {
      error.textContent = failure.message || 'Zapis się nie powiódł.';
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  };
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('[autofocus]')?.focus();
}

async function accountSession(action, data) {
  const errors = {
    400: 'Sprawdź wpisane dane.',
    409: 'Zapisz profil i spróbuj ponownie.',
    401: {
      requestLoginCode: 'Użyj adresu e-mail i przeglądarki, w której nastąpiło wylogowanie.',
      login: 'Kod jest nieprawidłowy lub wygasł. Wróć do poprzedniego kroku, aby pobrać nowy kod.',
      logout: 'Odśwież stronę i spróbuj ponownie.'
    }[action]
  };
  let response;
  try {
    response = await fetch(workspaceUrl, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action, ...data})
    });
  } catch {
    throw new Error('Sprawdź połączenie i spróbuj ponownie.');
  }
  if (!response.ok) throw new Error(errors[response.status] || 'Logowanie demo jest chwilowo niedostępne.');
  return response;
}

async function restoreProfile(data) {
  changingProfileSession = true;
  try {
    if (syncing) await syncing;
    const response = await accountSession('login', data);
    state = await response.json();
    localStorage.removeItem(pendingKey);
    localStorage.setItem(storageKey, JSON.stringify(state));
    refreshPage();
    announce('Przywrócono Twój profil.');
  } finally {
    changingProfileSession = false;
  }
}

function resetProfileSession() {
  localStorage.removeItem(storageKey);
  localStorage.removeItem(pendingKey);
  localStorage.removeItem(tokenKey);
  clearDutySession();
  lockUserAdministration();
  schedule = null;
  scheduleError = null;
  onlineDiscovery = undefined;
  onlineSearch = '';
  onlineError = '';
  skippedOnline.clear();
  restaurantBoard = undefined;
  shipStatistics = undefined;
  resetWelcomeDraw();
  notificationBoard = undefined;
  notificationError = '';
  pendingNotificationChat = undefined;
  state = {member: '', events: [], reports: []};
  render();
}

function beginProfileLogout() {
  openForm('Wyloguj się', `
    <p>Podaj adres e-mail, którego użyjesz do ponownego zalogowania w tej przeglądarce.</p>
    <label>Adres e-mail <input name="email" type="email" autocomplete="email" required maxlength="120" autofocus></label>`,
    'Wyloguj się', async (data, form) => {
      const sync = syncWorkspace();
      changingProfileSession = true;
      try {
        await sync;
        if (localStorage.getItem(pendingKey)) throw new Error('Najpierw zsynchronizuj dane. Sprawdź połączenie.');
        if (!dialog.open || !form.isConnected) return false;
        await accountSession('logout', {email: data.get('email')});
        resetProfileSession();
        localStorage.setItem(logoutKey, crypto.randomUUID());
        announce('Wylogowano.');
      } finally {
        changingProfileSession = false;
      }
    });
}

function beginProfileLogin(email = '') {
  openForm('Zaloguj się', `
    <label>Adres e-mail <input name="email" type="email" autocomplete="email" required maxlength="120"
      value="${escape(email)}" autofocus></label>
    <p class="muted">W wersji demo kod pojawi się w powiadomieniu na ekranie.</p>
    <button type="button" class="secondary" data-legacy-login>Użyj kodu powrotu lub kodu od administratora</button>`,
    'Pokaż kod demo', async (data, form) => {
      const address = data.get('email').trim();
      const response = await accountSession('requestLoginCode', {email: address});
      const {code} = await response.json();
      if (dialog.open && form.isConnected) enterProfileCode(address, code);
      return false;
    });
  dialog.querySelector('[data-legacy-login]').onclick = beginLegacyLogin;
}

function enterProfileCode(email, code) {
  openForm('Wpisz kod logowania', `
    <p class="note" role="status">Twój kod demo to <strong>${escape(code)}</strong>. Jest ważny przez 10 minut.</p>
    <label>Kod sześciocyfrowy <input name="code" inputmode="numeric" autocomplete="one-time-code"
      required pattern="[0-9]{6}" maxlength="6" autofocus></label>
    <button type="button" class="secondary" data-login-back>Wróć do adresu e-mail</button>`,
    'Zaloguj się', data => restoreProfile({email, code: data.get('code')}));
  dialog.querySelector('[data-login-back]').onclick = () => beginProfileLogin(email);
}

function beginLegacyLogin() {
  openForm('Zaloguj się zapisanym kodem', `
    <label>Kod dostępu <input name="code" required maxlength="64" autocomplete="off" spellcheck="false" autofocus></label>
    <button type="button" class="secondary" data-login-back>Wróć do adresu e-mail</button>`,
    'Zaloguj się', data => {
      const code = data.get('code').trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(code)) throw new Error('Wpisz 64-znakowy kod powrotu.');
      return restoreProfile({code});
    });
  dialog.querySelector('[data-login-back]').onclick = () => beginProfileLogin();
}

let adminKey = '';
let adminUsers = [];
let adminLogs = [];
const adminLogLabels = {create:'Dodano konto',archive:'Wyłączono konto',restore:'Przywrócono konto',
  publish:'Opublikowano kartę',hide:'Ukryto kartę',resetCode:'Wydano kod logowania'};
let newUserCode = '';

function lockUserAdministration() {
  adminKey = '';
  adminUsers = [];
  adminLogs = [];
  newUserCode = '';
}

async function adminRequest(payload, key = adminKey) {
  const response = await fetch('api/users', {
    method: payload ? 'POST' : 'GET',
    headers: {Authorization: 'Bearer ' + key, ...(payload ? {'Content-Type': 'application/json'} : {})},
    ...(payload ? {body: JSON.stringify(payload)} : {})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Panel jest chwilowo niedostępny.');
  return result;
}

async function refreshAdminUsers() {
  const {users,logs} = await adminRequest();
  adminUsers = users;
  adminLogs = logs ?? [];
}

function renderUserAdministration() {
  const heading = '<header class="crew-heading"><h1>Administracja użytkowników</h1></header>';
  if (!adminKey) return heading + '<section class="card"><p>Odblokuj panel kluczem administratora.</p>' +
    '<button class="primary" data-action="admin-unlock">Odblokuj panel</button></section>';
  return heading + `
    <div class="crew-filter"><button class="primary" data-action="admin-create">+ Dodaj użytkownika</button>
      <button class="secondary" data-action="admin-lock">Zablokuj panel</button></div>
    ${newUserCode ? `<section class="card"><h2>Kod logowania użytkownika</h2>
      <p>Przekaż go prywatnie. Użytkownik wpisze go po wybraniu „Zaloguj się kodem”.</p>
      <input aria-label="Jednorazowy kod logowania" value="${newUserCode}" readonly>
      <button class="secondary" data-action="admin-dismiss-code">Ukryj kod</button></section>` : ''}
    ${adminUsers.length > 6 ? '<label class="directory-filter">Szukaj użytkownika<input type="search" data-filter-list="admin-users" placeholder="Nazwa lub rola"></label>' : ''}
    <div class="admin-directory" id="admin-users">${adminUsers.map(user => `<article class="card" data-search-text="${escape(user.name + ' ' + (user.role || ''))}">
      <p class="badge">${user.archived ? 'Konto wyłączone' : user.published ? 'Profil opublikowany' : 'Bez publicznej karty'}</p>
      <h3>${escape(user.name)}</h3>${user.role ? `<p class="muted">${escape(user.role)}</p>` : ''}
      <footer>${user.archived ? `<button class="primary" data-action="admin-restore" data-id="${user.id}">Przywróć konto</button>` :
        `<button class="secondary" data-action="admin-${user.published ? 'hide' : 'publish'}" data-id="${user.id}">${user.published ? 'Ukryj kartę' : 'Opublikuj kartę'}</button>
        <button class="secondary" data-action="admin-resetCode" data-id="${user.id}">Wydaj kod logowania</button>
        <button class="secondary" data-action="admin-archive" data-id="${user.id}">Usuń z aktywnych</button>`}</footer></article>`).join('') ||
      '<p>Brak użytkowników.</p>'}</div>
    <p data-filter-empty="admin-users" role="status" hidden>Brak użytkowników pasujących do wyszukiwania.</p>
    <details class="card admin-audit"><summary>Dziennik operacji</summary>
      ${adminLogs.length ? `<ol>${adminLogs.map(log => `<li>
        <div><strong>${escape(adminLogLabels[log.action] || log.action)}</strong><span>${escape(log.name)}</span></div>
        <time datetime="${escape(log.at)}">${notificationTime.format(new Date(log.at))}</time></li>`).join('')}</ol>` :
        '<p class="muted">Brak zapisanych operacji.</p>'}</details>`;
}

async function handleUserAdministration(action, id) {
  if (action === 'admin-unlock') {
    openForm('Dostęp administratora',
      '<label>Klucz administratora <input type="password" name="key" required maxlength="64" autocomplete="off"></label>',
      'Odblokuj', async data => {
        const key = data.get('key').trim();
        const result = await adminRequest(null, key);
        adminKey = key;
        adminUsers = result.users;
        adminLogs = result.logs ?? [];
        render();
      });
    return;
  }
  if (!adminKey) return;
  if (action === 'admin-create') {
    openForm('Dodaj użytkownika', '<label>Nazwa <input name="name" required maxlength="80"></label>' +
      '<label>O Tobie na pokładzie (opcjonalnie) <input name="role" maxlength="60" placeholder="Np. pasażerka, podróżuję z rodziną"></label>', 'Dodaj konto', async data => {
        const result = await adminRequest({action: 'create', name: data.get('name'), role: data.get('role')});
        newUserCode = result.code;
        await refreshAdminUsers();
        render();
      });
    return;
  }
  if (action === 'admin-lock') {
    lockUserAdministration();
    render();
    return;
  }
  if (action === 'admin-dismiss-code') {
    newUserCode = '';
    render();
    return;
  }
  const operation = action.slice('admin-'.length);
  const questions = {archive: 'Wyłączyć to konto i ukryć jego kartę? Rozmowy zostaną w bazie.',
    publish: 'Opublikować kartę tej osoby w „Poznaj ludzi”? Zrób to tylko za jej zgodą.',
    resetCode: 'Wydać nowy kod logowania? Dotychczasowy niewykorzystany kod przestanie działać.'};
  if (questions[operation] && !window.confirm(questions[operation])) return;
  try {
    const result = await adminRequest({action: operation, id});
    if (result.code) newUserCode = result.code;
    await refreshAdminUsers();
    render();
    announce('Zapisano zmianę konta.');
  } catch (error) {
    announce(error.message);
  }
}

function editUserProfile(publishOnline = false) {
  const profile = state.userProfile;
  openForm(profile ? 'Edytuj profil' : 'Dodaj nowy profil', `
    <label>Nazwa wyświetlana <input name="displayName" required maxlength="80" autocomplete="nickname" value="${escape(profile?.name ?? '')}" autofocus></label>
    <label>Wiek (opcjonalnie) <input name="age" type="number" min="18" max="120" step="1" inputmode="numeric" value="${profile?.age ?? ''}"></label>
    <label>O Tobie na pokładzie (opcjonalnie) <input name="role" maxlength="60" placeholder="Np. pasażerka, podróżuję z rodziną" value="${escape(profile?.role ?? '')}"></label>
    <label>Płeć (opcjonalnie) <select name="gender"><option value="">Nie podaję</option>
      <option value="women" ${profile?.gender === 'women' ? 'selected' : ''}>Kobieta</option>
      <option value="men" ${profile?.gender === 'men' ? 'selected' : ''}>Mężczyzna</option>
    </select></label>
    <label>O mnie <textarea name="bio" rows="3" maxlength="300">${escape(profile?.bio ?? '')}</textarea></label>
    <label>Zainteresowania <input name="interests" maxlength="180" aria-describedby="interests-hint" value="${escape(profile?.interests.join(', ') ?? '')}"></label>
    <small id="interests-hint" class="muted">Do 6 zainteresowań oddzielonych przecinkami.</small>
    <label>Czego szukasz? <select name="intent"><option value="">Wybierz opcjonalnie</option>
      ${Object.entries(datingIntents).map(([value, label]) => `<option value="${value}" ${profile?.intent === value ? 'selected' : ''}>${label}</option>`).join('')}
    </select></label>
    <label>Pytanie na przełamanie lodów <input name="icebreaker" maxlength="120" placeholder="Np. Jaki port chcesz odwiedzić ponownie?" value="${escape(profile?.icebreaker ?? '')}"></label>
    ${publishOnline ? '<p class="muted">Zapis opublikuje dane z formularza w „Poznaj ludzi”.</p>' : ''}`,
    publishOnline ? 'Zapisz i opublikuj' : 'Zapisz profil', async (data, form) => {
    const name = data.get('displayName').trim().replace(/\s+/gu, ' ');
    const age = data.get('age') ? Number(data.get('age')) : null;
    if (age !== null && (!Number.isInteger(age) || age < 18 || age > 120)) {
      throw new Error('Wpisz wiek od 18 do 120 lat albo zostaw pole puste.');
    }
    const role = data.get('role').trim();
    const bio = data.get('bio').trim();
    const interests = [...new Set(data.get('interests').split(',').map(interest => interest.trim()).filter(Boolean))];
    if (!name || /\p{Cc}/u.test(name)) {
      form.elements.displayName.focus();
      throw new Error('Wpisz nazwę wyświetlaną.');
    }
    if (interests.length > 6 || interests.some(interest => interest.length > 28)) {
      form.elements.interests.focus();
      throw new Error('Wpisz do 6 zainteresowań, każde po maksymalnie 28 znaków.');
    }
    const existing = state.userProfile;
    const id = existing?.id ?? 'profile-' + crypto.randomUUID();
    const updatedProfile = {id, name, age, role, bio, interests, intent: data.get('intent'),
      gender: data.get('gender'), icebreaker: data.get('icebreaker').trim()};
    if (publishOnline) {
      await syncWorkspace();
      await discoveryRequest({action: 'publish', profile: updatedProfile});
    }
    state.userProfile = updatedProfile;
    activatePersonalProfile();
    save('Zapisano profil.');
    void loadNotifications();
    if (publishOnline) void refreshDiscovery();
  });
  dialog.addEventListener('close', () => {
    content.querySelector('[data-action="profile-edit"]')?.focus();
  }, {once: true});
}

function createEvent(day) {
  const preferredTime = day && new Date(day + 'T18:00') > new Date() ? day + 'T18:00' : '';
  openForm('Nowa aktywność', `
    <label>Nazwa <input name="title" maxlength="90" required></label>
    <label>Kategoria <select name="type"><option>Gry</option><option>Trening</option><option>Integracja</option><option>Inne</option></select></label>
    <label>Opis <textarea name="description" maxlength="500"></textarea></label>
    <div class="capacity-field">
      <label for="event-capacity">Maksymalna liczba osób <output for="event-capacity" id="capacity-value">8</output></label>
      <input id="event-capacity" name="capacity" type="range" min="2" max="30" value="8" aria-describedby="capacity-hint">
      <small id="capacity-hint">Od 2 do 30 osób, razem z organizatorem.</small>
    </div>
    <label>Pierwszy termin <input type="datetime-local" name="slot" value="${preferredTime}" required></label>
    <label>Drugi termin <input type="datetime-local" name="slot" required></label>
    <label>Trzeci termin (opcjonalnie) <input type="datetime-local" name="slot"></label>
    ${eventsAvailable ? '<p class="muted">Wydarzenie pojawi się na wspólnej tablicy dostępnej dla osób korzystających z tej aplikacji.</p>' : ''}
    <p class="muted">Jako organizator deklarujesz dostępność w proponowanych terminach. Możesz ją później zmienić.</p>`, 'Utwórz aktywność', (data, form) => {
    const selected = data.getAll('slot').filter(Boolean);
    const slots = [...new Set(selected)].sort();
    const name = data.get('title').trim();
    if (!name || slots.length !== selected.length || slots.some(slot => new Date(slot) <= new Date())) {
      const input = name ? form.querySelector('[name=slot]') : form.elements.title;
      input.setCustomValidity(name ? 'Wybierz różne terminy w przyszłości.' : 'Wpisz nazwę aktywności.');
      input.reportValidity();
      form.addEventListener('input', () => input.setCustomValidity(''), {once: true});
      return false;
    }
    const event = {id: crypto.randomUUID(), title: name, owner: state.member,
      type: data.get('type'), capacity: Number(data.get('capacity')), description: data.get('description').trim(), slots,
      votes: {[state.member]: slots.map((_, index) => index)}};
    state.events.unshift(event);
    save(eventsAvailable ? 'Zapisywanie wydarzenia na tablicy pokładowej…' : 'Zapisano wydarzenie w tej przeglądarce.');
    if (eventsAvailable) void publishEvent(event);
  });
  const slider = dialog.querySelector('#event-capacity');
  const value = dialog.querySelector('#capacity-value');
  slider.addEventListener('input', () => { value.value = slider.value; });
}

function vote(event) {
  const existing = event.votes[state.member] || [];
  openForm('Twoja dostępność', `<fieldset><legend>Zaznacz wszystkie pasujące terminy</legend>
    ${event.slots.map((slot, index) => `<label><input type="checkbox" name="slot" value="${index}" ${existing.includes(index) ? 'checked' : ''}> ${formatDate(slot)}</label>`).join('')}
    <p data-error role="alert"></p></fieldset>`, 'Zapisz dostępność', (data, form) => {
    const selected = data.getAll('slot').map(Number);
    if (!selected.length) {
      form.querySelector('[data-error]').textContent = 'Wybierz co najmniej jeden termin.';
      return false;
    }
    const currentEvent = allEvents().find(item => item.id === event.id);
    if (!currentEvent?.votes[state.member] && (!currentEvent || isFull(currentEvent))) {
      form.querySelector('[data-error]').textContent = 'Na tę aktywność nie ma już wolnych miejsc.';
      return false;
    }
    if (isShared(currentEvent)) {
      void updateSharedEvent({
        action: 'vote', id: event.id, member: state.member, vote: selected, displayName: personalName(state.member)
      }, 'Zapisano dostępność.');
      return;
    }
    currentEvent.votes[state.member] = selected;
    save('Zapisano dostępność.');
  });
}

content.addEventListener('submit', event => {
  if (event.target.id !== 'online-people-search') return;
  event.preventDefault();
  onlineSearch = event.target.elements.name.value.trim().slice(0, 80);
  render();
  content.querySelector('#online-name')?.focus();
});

content.addEventListener('click', e => {
  const button = e.target.closest('button[data-action]');
  if (!button) return;
  const {action, id} = button.dataset;
  if (action === 'welcome-draw' || action === 'welcome-draw-refresh') {
    void (action === 'welcome-draw' ? drawWelcomeReward() : loadWelcomeDraw());
    return;
  }
  if (action === 'statistics-refresh') {
    void loadShipStatistics();
    return;
  }
  if (action.startsWith('restaurant-')) {
    void handleRestaurantAction(action, id);
    return;
  }
  if (action.startsWith('admin-')) {
    void handleUserAdministration(action, id);
    return;
  }
  if (action === 'online-profile-edit') {
    editUserProfile(true);
    return;
  }
  if (action === 'profile-logout' && state.userProfile) {
    beginProfileLogout();
    return;
  }
  if (action === 'profile-login' && !state.userProfile) {
    beginProfileLogin();
    return;
  }
  if (action === 'profile-edit') {
    editUserProfile();
    return;
  }
  if (action === 'online-clear-search') {
    onlineSearch = '';
    render();
    content.querySelector('#online-name')?.focus();
    return;
  }
  if (action === 'online-publish' && personalDiscovery()) {
    const profile = {...state.userProfile, gender: state.userProfile.gender ?? ''};
    void updateOnlineDiscovery({action: 'publish', profile}, 'Profil online zapisany.');
    return;
  }
  if (action === 'online-hide' && personalDiscovery()) {
    void updateOnlineDiscovery({action: 'hide'}, 'Profil ukryty.');
    return;
  }
  if (action === 'online-reset' && personalDiscovery()) {
    if (window.confirm('Usunąć wszystkie Twoje polubienia i dopasowania? Wiadomości zostaną zachowane.')) {
      skippedOnline.clear();
      void updateOnlineDiscovery({action: 'resetMatches'}, 'Usunięto historię dopasowań.');
    }
    return;
  }
  if (action === 'online-revisit') {
    skippedOnline.clear();
    render();
    return;
  }
  if (action === 'crew-chat') {
    openCrewChat(button.dataset.profile);
    return;
  }
  if (action === 'crew-skip' || action === 'crew-connect') {
    void reactToCrewCard(button.dataset.profile, action === 'crew-connect' ? 'connect' : 'skip');
    return;
  }
  const event = allEvents().find(item => item.id === id);
  if (action === 'event') createEvent(button.dataset.day);
  if (action.startsWith('calendar-')) {
    if (action === 'calendar-day' || action === 'calendar-today') {
      selectedDay = button.dataset.day || dateValue();
    } else {
      const month = new Date(visibleMonth + '-01T12:00');
      month.setMonth(month.getMonth() + (action === 'calendar-next' ? 1 : -1));
      selectedDay = calendarDate(month);
    }
    visibleMonth = selectedDay.slice(0, 7);
    render();
    const focusTarget = action === 'calendar-day' ? '[aria-pressed="true"]' : `[data-action="${action}"]`;
    content.querySelector(focusTarget)?.focus();
  }
  if (action === 'publish' && event && event.owner === state.member &&
      window.confirm('Opublikować wydarzenie na wspólnej tablicy tej aplikacji?')) void publishEvent(event);
  if (action === 'vote' && event) vote(event);
  if (action === 'leave' && event && event.owner !== state.member) {
    if (isShared(event)) {
      void updateSharedEvent({action: 'vote', id, member: state.member, vote: null}, 'Wypisano Cię z aktywności.');
      return;
    }
    delete event.votes[state.member];
    save('Wypisano Cię z aktywności.');
  }
  if (action === 'report' || action === 'local-report' || action.startsWith('duty-')) void handleDutyAction(button);
});
let reactingToCard = false;
async function reactToCrewCard(profile, choice) {
  if (reactingToCard) return;
  const card = content.querySelector('#crew-card');
  if (!card || card.dataset.profile !== profile) return;
  const memberAtStart = state.member;
  reactingToCard = true;
  try {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && card.animate) {
      const direction = choice === 'connect' ? 1 : -1;
      card.dataset.swipe = choice;
      card.style.setProperty('--swipe-strength', '1');
      await card.animate([
        {transform: card.style.transform || 'none', opacity: 1},
        {transform: `translateX(${direction * 175}px) rotate(${direction * 14}deg)`, opacity: 0}
      ], {duration: 210, easing: 'ease-in', fill: 'forwards'}).finished.catch(() => {});
    }
    if (state.member === memberAtStart && location.hash === '#zaloga') chooseCrewProfile(profile, choice);
  } finally {
    card.getAnimations?.().forEach(animation => animation.cancel());
    resetSwipeCard(card);
    reactingToCard = false;
  }
}

function resetSwipeCard(card) {
  card.style.transform = '';
  card.style.removeProperty('--swipe-strength');
  delete card.dataset.swipe;
  card.classList.remove('dragging');
}

let swipe;
content.addEventListener('pointerdown', event => {
  const card = event.target.closest('#crew-card');
  if (!card || reactingToCard || !event.isPrimary || event.button !== 0) return;
  swipe = {card, pointer: event.pointerId, x: event.clientX, y: event.clientY};
  card.classList.add('dragging');
  card.setPointerCapture(event.pointerId);
});

content.addEventListener('pointermove', event => {
  if (swipe?.pointer !== event.pointerId) return;
  const dx = event.clientX - swipe.x;
  const dy = event.clientY - swipe.y;
  if (Math.abs(dx) <= Math.abs(dy)) return;
  const shift = Math.max(-90, Math.min(90, dx));
  const strength = Math.min(1, Math.abs(dx) / 70);
  swipe.card.dataset.swipe = shift > 0 ? 'connect' : 'skip';
  swipe.card.style.setProperty('--swipe-strength', String(strength));
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    swipe.card.style.transform = `translateX(${shift}px) rotate(${shift / 12}deg)`;
  }
});

function finishSwipe(event) {
  if (swipe?.pointer !== event.pointerId) return;
  const {card, x, y} = swipe;
  swipe = undefined;
  const dx = event.clientX - x;
  const dy = event.clientY - y;
  if (event.type === 'pointerup' && card.isConnected && Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.25) {
    void reactToCrewCard(card.dataset.profile, dx > 0 ? 'connect' : 'skip');
  } else {
    resetSwipeCard(card);
  }
}
content.addEventListener('pointerup', finishSwipe);
content.addEventListener('pointercancel', finishSwipe);
content.addEventListener('lostpointercapture', finishSwipe);

content.addEventListener('change', event => {
  const {id, value} = event.target;
  if (id === 'crew-intent' || id === 'crew-interest') {
    if (!state.discoveryFilters) state.discoveryFilters = {};
    const key = id === 'crew-intent' ? 'intent' : 'interest';
    state.discoveryFilters[state.member] = {...discoveryFilters(), [key]: value};
    save();
    content.querySelector('#' + id)?.focus();
    return;
  }
  if (event.target.id !== 'crew-gender' || !Object.keys(genderFilters).includes(event.target.value)) return;
  if (!state.crewPreferences) state.crewPreferences = {};
  state.crewPreferences[state.member] = event.target.value;
  save('Zapisano preferencję profilu.');
  content.querySelector('#crew-gender')?.focus();
});

content.addEventListener('toggle', event => {
  const disclosure = event.target;
  const key = disclosure.dataset?.dutyDisclosure;
  if (key && disclosure.isConnected) {
    if (disclosure.open) dutyDisclosures.add(key);
    else dutyDisclosures.delete(key);
  }
}, true);

function refreshPage() {
  render();
  if (location.hash === '#restauracje') {
    void loadRestaurants();
    void loadWelcomeDraw();
  }
  if (location.hash === '#statystyki') void loadShipStatistics();
  void refreshDiscovery();
  if (isDutyPage() && state.userProfile) void loadDuties();
}
window.addEventListener('hashchange', () => {
  refreshPage();
  if (isDutyPage()) window.scrollTo(0, 0);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isDutyPage()) void loadDuties();
});
window.addEventListener('storage', event => {
  if (event.key === logoutKey && event.newValue) {
    if (dialog.open) dialog.close();
    resetProfileSession();
    return;
  }
  if (event.key === storageKey && event.newValue) {
    state = JSON.parse(event.newValue);
    render();
  }
});
const updateNetwork = () => {
  const connectedProfile = isDutyPage() ? hostedDuties : state.userProfile?.id === state.member;
  document.querySelector('#network').textContent = connectedProfile ? (navigator.onLine ? 'Online' : 'Offline') :
    (navigator.onLine ? 'Brak aktywnego profilu' : 'Offline');
};
window.addEventListener('online', () => {
  updateNetwork();
  void syncWorkspace();
  if (isDutyPage() && state.userProfile) void loadDuties();
});
window.addEventListener('offline', updateNetwork);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.error);
refreshPage();
void syncWorkspace();
void loadNotifications();

void refreshEvents();
window.addEventListener('focus', refreshEvents);
window.addEventListener('focus', refreshDiscovery);
window.addEventListener('online', refreshDiscovery);
setInterval(() => { if (!document.hidden) void refreshDiscovery(); }, 3000);
window.addEventListener('online', refreshEvents);
window.addEventListener('online', loadRestaurants);
window.addEventListener('online', loadShipStatistics);
window.addEventListener('online', loadWelcomeDraw);
setInterval(() => { if (!document.hidden) void refreshEvents(); }, 15000);
