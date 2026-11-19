const crewProfiles = [
  {name: 'Marek Nowak', gender: 'men', role: 'Marynarz pokładowy', initials: 'MN', color: 'teal',
    bio: 'Chętnie zagram mecz FIFA albo zorganizuję wieczór z planszówkami.', interests: ['FIFA', 'Planszówki']},
  {name: 'Anna Kowalska', gender: 'women', role: 'Oficer wachtowy', initials: 'AK', color: 'plum',
    bio: 'Szukam towarzystwa do wspólnych treningów i rozmów przy kawie.', interests: ['Trening', 'Kawa']},
  {name: 'Piotr Zieliński', gender: 'men', role: 'Mechanik', initials: 'PZ', color: 'blue',
    bio: 'Po wachcie najchętniej oglądam filmy albo gram w szachy.', interests: ['Filmy', 'Szachy']},
  {name: 'Julia Wójcik', gender: 'women', role: 'Oficer nawigacyjny', initials: 'JW', color: 'blue',
    bio: 'Lubię fotografować wschody słońca i dzielić się zdjęciami z rejsu.', interests: ['Fotografia', 'Podróże']},
  {name: 'Tomasz Lewandowski', gender: 'men', role: 'Bosman', initials: 'TL', color: 'teal',
    bio: 'Po pracy chętnie rozgrywam kilka partii w ping-ponga.', interests: ['Tenis stołowy', 'Quizy']},
  {name: 'Natalia Mazur', gender: 'women', role: 'Elektryk okrętowy', initials: 'NM', color: 'plum',
    bio: 'Mam słabość do kryminałów i chętnie wymienię się książkami.', interests: ['Książki', 'Podcasty']},
  {name: 'Oskar Kamiński', gender: 'men', role: 'Kucharz okrętowy', initials: 'OK', color: 'teal',
    bio: 'Chętnie wymienię się przepisami albo pogram na gitarze po kolacji.', interests: ['Gotowanie', 'Gitara']},
  {name: 'Karolina Lis', gender: 'women', role: 'Marynarz pokładowy', initials: 'KL', color: 'blue',
    bio: 'Szukam ekipy do porannej rozgrzewki i wspólnego oglądania meczów.', interests: ['Fitness', 'Piłka nożna']},
  {name: 'Michał Dąbrowski', gender: 'men', role: 'Mechanik wachtowy', initials: 'MD', color: 'plum',
    bio: 'Najchętniej spędzam wolny wieczór przy grze kooperacyjnej.', interests: ['Gry kooperacyjne', 'Łamigłówki']},
  {name: 'Zofia Król', gender: 'women', role: 'Kadetka pokładowa', initials: 'ZK', color: 'teal',
    bio: 'Uczę się hiszpańskiego i chętnie poćwiczę konwersację przy herbacie.', interests: ['Hiszpański', 'Herbata']},
];
const crew = crewProfiles.map(profile => profile.name);
const genderFilters = {all: 'Wszystkich', women: 'Kobiety', men: 'Mężczyzn'};
const datingIntents = {dates: 'Randki', relationship: 'Związek', friendship: 'Znajomości', activities: 'Wspólne aktywności'};
const interestKey = interest => interest.trim().toLocaleLowerCase('pl');
const discoveryFilters = () => state.discoveryFilters?.[state.member] ?? {};
const demoIntents = Object.keys(datingIntents);
const profileIntent = profile => profile.intent || (profile.id ? '' : demoIntents[crewProfiles.indexOf(profile) % demoIntents.length]);
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
    announce('Nie udało się zapisać na tablicy załogi. Spróbuj ponownie po odzyskaniu połączenia.');
  }
}
const publishEvent = event => updateSharedEvent({
  ...event, capacity: event.capacity ?? 30, action: 'publish', displayName: personalName(event.owner)
}, 'Wydarzenie jest widoczne na tablicy załogi.');
const pendingKey = 'crewconnect-workspace-pending';
const apiBase = document.querySelector('meta[name="crewconnect-api"]')?.content;
const workspaceUrl = apiBase ? new URL('/api/workspace', apiBase).href : 'api/workspace';
const tokenKey = 'crewconnect-workspace-token:' + workspaceUrl;
let syncing = false;

async function syncWorkspace() {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    let token = localStorage.getItem(tokenKey);
    const headers = () => token ? {Authorization: 'Bearer ' + token} : {};
    const response = await fetch(workspaceUrl, {cache: 'no-store', headers: headers()});
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
  } finally {
    syncing = false;
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
const initial = {
  member: crew[0],
  events: [{
    id: 'fifa', title: 'Turniej FIFA', type: 'Gry', owner: crew[0],
    description: 'Spotykamy się w mesie. Każdy rozegra co najmniej jeden mecz.',
    slots: [dateValue(1) + 'T18:00', dateValue(2) + 'T20:00', dateValue(3) + 'T19:00'],
    votes: {[crew[0]]: [0, 1], [crew[1]]: [1, 2]}
  }],
  reports: [{
    id: 'example', title: 'Kontrola wyposażenia mesy', owner: crew[1],
    status: 'Wykonano', date: dateValue(), notes: 'Wyposażenie sprawdzone i odłożone na miejsce.'
  }]
};
let state = JSON.parse(localStorage.getItem(storageKey) || 'null') || initial;
const content = document.querySelector('#content');
const dialog = document.querySelector('#dialog');
const member = document.querySelector('#crew');
const personalOption = document.createElement('option');
const notice = document.querySelector('#notice');
let noticeTimer;
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const profileId = profile => profile.id ?? profile.name;
const isWorkspaceMember = id => crew.includes(id) || (typeof id === 'string' && id === state.userProfile?.id);
const initials = name => name.split(/\s+/u).slice(0, 2).map(part => [...part][0]).join('').toLocaleUpperCase('pl');
const personalName = id => state.userProfile?.id === id ? state.userProfile?.name : undefined;
const displayName = (id, names) => personalName(id) ?? (names && Object.hasOwn(names, id) ? names[id] : id);

function currentRoster() {
  const profile = state.userProfile;
  return profile ? [{...profile, color: 'teal', initials: initials(profile.name)}, ...crewProfiles] : crewProfiles;
}

function renderMemberSelector() {
  const profile = state.userProfile;
  if (profile) {
    personalOption.value = profile.id;
    personalOption.textContent = profile.name;
    if (!personalOption.isConnected) member.prepend(personalOption);
  } else {
    personalOption.remove();
  }
  member.value = state.member;
}

const formatDate = value => new Intl.DateTimeFormat('pl-PL', {
  weekday: 'short', day: 'numeric', month: 'short',
  ...(value.includes('T') ? {hour: '2-digit', minute: '2-digit'} : {})
}).format(new Date(value.includes('T') ? value : value + 'T12:00'));
const participants = event => Object.keys(event.votes);
const isFull = event => Number.isInteger(event.capacity) && participants(event).length >= event.capacity;
function signupButton(event, style) {
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
    <header class="calendar-header"><div><h1 id="calendar-title">Wspólny kalendarz załogi</h1><h2>${monthLabel.format(first)}</h2></div>
      <div class="calendar-controls">
        <button class="secondary" data-action="calendar-today">Dzisiaj</button>
        <button class="secondary" data-action="calendar-prev" aria-label="Poprzedni miesiąc">‹</button>
        <button class="secondary" data-action="calendar-next" aria-label="Następny miesiąc">›</button>
      </div>
    </header>
    <div class="calendar-grid">${['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'].map(day => `<span class="weekday">${day}</span>`).join('')}${cells}</div>
  </section>
  <section class="card agenda"><header><h2>${dayLabel.format(new Date(selectedDay + 'T12:00'))}</h2>
    <button class="primary" data-action="event" data-day="${selectedDay}">+ Nowa aktywność</button></header>
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
  return `<article class="card">
    <span class="badge">${escape(event.type)}</span>
    <h3>${escape(event.title)}</h3>
    <p class="muted">Organizuje ${escape(displayName(event.owner, event.memberNames))}</p>
    ${event.description ? `<p>${escape(event.description)}</p>` : ''}
    <p class="note"><strong>${summary}</strong></p>
    <p class="muted">${people.length}${event.capacity ? ' / ' + event.capacity : ''} zapisanych${people.length ? ' · ' + escape(people.map(id => displayName(id, event.memberNames)).join(', ')) : ''}</p>
    <footer>${signupButton(event, 'primary')}
    ${isShared(event) ? '<span class="badge">Tablica załogi</span>' : eventsAvailable && event.id !== 'fifa' && event.owner === state.member ? `<button class="secondary" data-action="publish" data-id="${event.id}">Opublikuj dla załogi</button>` : ''}
    ${event.votes[state.member] && event.owner !== state.member ? `<button class="secondary" data-action="leave" data-id="${event.id}">Wypisz się</button>` : ''}</footer>
  </article>`;
}

function profileDetails(profile, sharedInterests = []) {
  const intent = datingIntents[profileIntent(profile)];
  const tags = profile.interests.map(interest => {
    const common = sharedInterests.includes(interestKey(interest));
    return `<span${common ? ' class="common-interest"' : ''}>${common ? '✓ ' : ''}${escape(interest)}</span>`;
  }).join('');
  return `<h2>${escape(profile.name)}</h2>
    ${profile.role ? `<p class="muted">${escape(profile.role)}</p>` : ''}
    ${profile.bio ? `<p class="profile-bio">${escape(profile.bio)}</p>` : ''}
    ${intent ? `<p class="profile-intent">Szukam: <strong>${intent}</strong></p>` : ''}
    ${tags ? `<div class="crew-interests">${tags}</div>` : ''}
    ${profile.icebreaker ? `<p class="note"><strong>Zacznijmy od pytania</strong><br>${escape(profile.icebreaker)}</p>` : ''}`;
}

function renderUserProfile() {
  const profile = state.userProfile;
  const selected = profile && state.member === profile.id;
  return `<header class="crew-heading"><h1>Mój profil</h1></header>
    <article class="card profile-card">
      <div class="crew-portrait teal"><span aria-hidden="true">${profile ? escape(initials(profile.name)) : '◇'}</span></div>
      <div class="crew-details">
        ${profile ? profileDetails(profile) : '<h2>Przedstaw się załodze</h2><p class="muted">Wybierz nazwę i dodaj kilka słów o sobie.</p>'}
        <footer>
          <button class="primary" data-action="profile-edit">${profile ? 'Edytuj profil' : 'Utwórz profil'}</button>
          ${profile && !selected ? '<button class="secondary" data-action="profile-use">Użyj tego profilu</button>' : ''}
        </footer>
      </div>
    </article>
    <p class="muted profile-note">Profil jest przypisany do tej przeglądarki. Na wspólnej tablicy załoga widzi Twoją nazwę przy aktywnościach.</p>`;
}

let onlineDiscovery;
let discoveryLoading = false;
let onlineError = '';
let onlineSearch = '';
const skippedOnline = new Set();
const personalDiscovery = () => Boolean(state.userProfile && state.member === state.userProfile.id);
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
      if (match && !dialog.open) openCrewChat(match, true);
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
        <span class="swipe-initials" aria-hidden="true">${escape(profile.initials || initials(profile.name))}</span>
        <strong class="swipe-stamp swipe-like" aria-hidden="true">Chcę poznać</strong>
        <strong class="swipe-stamp swipe-pass" aria-hidden="true">Pomijam</strong>
      </div>
      <div class="crew-details">${profileDetails(profile, commonInterests)}</div>
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
  const heading = '<header class="crew-heading"><h1>Poznaj załogę online</h1>' +
    '<button class="secondary" data-action="online-reset">Usuń historię dopasowań</button></header>';
  const error = onlineError ? `<p class="form-error" role="status">${escape(onlineError)}</p>` : '';
  if (!onlineDiscovery) return heading + (error || '<p>Ładowanie profili online…</p>');
  if (!onlineDiscovery.published) return heading + `<div class="card"><h2>Opublikuj swój profil</h2>
    <p>Osoby korzystające z CrewConnect zobaczą Twoją nazwę, opis, zainteresowania i intencje. Czat otwiera się po obustronnym polubieniu.</p>
    <button class="primary" data-action="online-publish">Opublikuj profil</button></div>${error}`;
  const profiles = onlineDiscovery.profiles;
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
  const choices = state.crewConnections?.[state.member] ?? {};
  const others = currentRoster().filter(profile => profileId(profile) !== state.member);
  const matches = others.filter(profile => isCrewMatch(profileId(profile)));
  const visibleProfiles = others.filter(matchesDiscoveryFilters);
  const myInterests = currentRoster().find(profile => profileId(profile) === state.member)?.interests ?? [];
  const shared = profile => profile.interests.map(interestKey).filter(interest => myInterests.some(item => interestKey(item) === interest));
  const available = visibleProfiles.filter(profile => !choices[profileId(profile)]);
  const candidate = available.sort((a, b) => shared(b).length - shared(a).length)[0];
  const interestOptions = new Map(others.flatMap(profile => profile.interests.map(item => [interestKey(item), item])));
  const filters = discoveryFilters();
  const option = (value, label, selected) => `<option value="${escape(value)}" ${value === selected ? 'selected' : ''}>${escape(label)}</option>`;
  const card = candidate ? renderDiscoveryCard(candidate, shared(candidate)) : `
    <div class="card crew-empty"><h2>Brak nowych kart w tym widoku</h2>
    ${visibleProfiles.some(profile => choices[profileId(profile)] === 'skip') ? '<button class="secondary" data-action="crew-revisit">Pokaż pominięte osoby</button>' : ''}</div>`;
  return `<header class="crew-heading"><h1>Poznaj załogę</h1><p class="muted">Znajdź osoby, z którymi chcesz spędzić czas po wachcie.</p>
    <div class="crew-filter">
      ${state.userProfile ? '<button class="primary" data-action="go-online">Przejdź do mojego profilu online</button>' : '<a class="primary" href="#profil">Utwórz własny profil</a>'}
      <button class="secondary" data-action="demo-reset">Usuń historię dopasowań</button>
    </div><p class="muted">Oglądasz profile demo. Aby dopasować się ze znajomym na innym urządzeniu, oboje wybierzcie i opublikujcie własny profil.</p></header>
    <div class="crew-filter"><label for="crew-gender">Kogo chcesz poznawać?</label>
      <select id="crew-gender">${Object.entries(genderFilters).map(([value, label]) =>
        `<option value="${value}" ${preferredGender() === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <label for="crew-intent">Intencje</label><select id="crew-intent">
        <option value="">Dowolne</option>
        ${Object.entries(datingIntents).map(([value, label]) => option(value, label, filters.intent)).join('')}
      </select>
      <label for="crew-interest">Zainteresowanie</label><select id="crew-interest">
        <option value="">Dowolne</option>
        ${[...interestOptions].sort((a, b) => a[1].localeCompare(b[1], 'pl')).map(([value, label]) => option(value, label, filters.interest)).join('')}
      </select>
    </div>
    <div class="crew-layout"><section aria-label="Profile załogi">${card}</section>
      <aside class="card crew-matches"><h2>Dopasowania</h2>
        ${matches.length ? matches.map(profile => `<div class="crew-match">
          <span class="crew-avatar ${profile.color}" aria-hidden="true">${escape(profile.initials)}</span>
          <div><strong>${escape(profile.name)}</strong>${profile.role ? `<p class="muted">${escape(profile.role)}</p>` : ''}</div>
          <button class="secondary" data-action="crew-chat" data-profile="${escape(profileId(profile))}" aria-label="Otwórz czat z ${escape(profile.name)}">Czat</button>
        </div>`).join('') : '<p class="muted">Dopasowanie pojawi się, gdy obie osoby wybiorą „Chcę poznać”.</p>'}
      </aside></div>`;
}

function isCrewMatch(profile, memberId = state.member) {
  return profile !== memberId && state.crewConnections?.[memberId]?.[profile] === 'connect' &&
    state.crewConnections?.[profile]?.[memberId] === 'connect';
}

const conversationKey = (first, second) => JSON.stringify([first, second].sort());
const chatTime = new Intl.DateTimeFormat('pl-PL', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

function openCrewChat(profile, celebrate = false) {
  const sender = state.member;
  const online = personalDiscovery() && onlineDiscovery?.matches.includes(profile);
  if (dialog.open || (!online && (!isWorkspaceMember(profile) || !isCrewMatch(profile, sender)))) return;
  const key = conversationKey(sender, profile);
  const peerName = online ? onlinePeer(profile)?.name : displayName(profile);
  if (!peerName) return;
  const name = escape(peerName);
  const author = online ? onlineDiscovery.me : sender;
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
      <form class="chat-compose">
        <label>Wiadomość <textarea name="message" rows="2" maxlength="500" required></textarea></label>
        <button type="submit" class="primary">Wyślij</button>
      </form>
    </div>`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  const history = dialog.querySelector('.chat-messages');
  const form = dialog.querySelector('.chat-compose');
  const input = form.elements.message;
  let remoteMessages = [];
  function renderMessages() {
    const messages = online ? remoteMessages : state.crewChats?.[key] ?? [];
    history.innerHTML = messages.map(message => `
      <article class="chat-message${message.sender === author ? ' own' : ''}">
        <span class="chat-meta">${message.sender === author ? 'Ty' : name} · ${chatTime.format(new Date(message.at))}</span>
        <p>${escape(message.text)}</p>
      </article>`).join('') || '<p class="muted">Wyślij pierwszą wiadomość.</p>';
    history.scrollTop = history.scrollHeight;
  }
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
    if (!online || chatLoading || !dialog.open || !form.isConnected) return;
    chatLoading = true;
    try {
      const {messages} = await discoveryRequest(null, profile);
      if (form.isConnected && JSON.stringify(messages) !== JSON.stringify(remoteMessages)) {
        remoteMessages = messages;
        renderMessages();
      }
    } catch (error) {
      announce(error.message);
    } finally {
      chatLoading = false;
    }
  }
  const pollChat = online ? setInterval(reloadMessages, 3000) : undefined;
  form.onsubmit = async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (online) {
      const submit = form.querySelector('[type=submit]');
      if (!text || text.length > 500 || submit.disabled) return;
      submit.disabled = true;
      try {
        await discoveryRequest({action: 'message', peer: profile, text});
        input.value = '';
        await reloadMessages();
      } catch (error) {
        announce(error.message);
      } finally {
        submit.disabled = false;
        input.focus();
      }
      return;
    }
    if (!text || text.length > 500 || state.member !== sender || !isCrewMatch(profile, sender)) return;
    if (!state.crewChats) state.crewChats = {};
    const messages = state.crewChats[key] ?? [];
    state.crewChats[key] = [...messages, {sender, text, at: new Date().toISOString()}];
    save();
    input.value = '';
    renderMessages();
    input.focus();
  };
  dialog.querySelector('[data-start-chat]').onclick = showChat;
  const refresh = event => { if (event.key === storageKey && dialog.open && form.isConnected) renderMessages(); };
  window.addEventListener('storage', refresh);
  dialog.addEventListener('close', () => {
    window.removeEventListener('storage', refresh);
    clearInterval(pollChat);
    dialog.classList.remove('crew-chat-dialog');
    [...content.querySelectorAll('[data-action="crew-chat"]')].find(button => button.dataset.profile === profile)?.focus();
  }, {once: true});
  dialog.showModal();
  if (online) void reloadMessages();
  if (celebrate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(showChat, 1500);
  else showChat();
}

function chooseCrewProfile(profile, choice) {
  if (personalDiscovery() && onlinePeer(profile)) {
    if (choice === 'connect') void updateOnlineDiscovery({action: 'like', peer: profile});
    else {
      skippedOnline.add(profile);
      onlineSearch = '';
      render();
    }
    return;
  }
  if (profile === state.member || !isWorkspaceMember(profile)) return;
  if (!state.crewConnections) state.crewConnections = {};
  if (!state.crewConnections[state.member]) state.crewConnections[state.member] = {};
  const choices = state.crewConnections[state.member];
  if (choices[profile]) return;
  choices[profile] = choice;
  const matched = isCrewMatch(profile);
  save(matched ? 'Nowe dopasowanie: ' + displayName(profile) : choice === 'connect' ? 'Zapisano zainteresowanie.' : 'Pominięto profil.');
  if (matched) {
    openCrewChat(profile, true);
    return;
  }
  (content.querySelector('[data-action="crew-skip"], [data-action="crew-revisit"]') || content.querySelector('h1'))?.focus();
}

function render() {
  const page = location.hash.slice(1);
  const reports = isDutyPage(page);
  document.body.classList.toggle('on-duties', reports);
  const calendar = page === 'kalendarz';
  const discover = page === 'zaloga';
  const profile = page === 'profil';
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === (calendar || reports || discover || profile ? page : 'aktywnosci')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  renderMemberSelector();
  updateNetwork();
  if (profile) {
    content.innerHTML = renderUserProfile();
  } else if (discover) {
    content.innerHTML = renderCrew();
    content.querySelector('h1').tabIndex = -1;
  } else if (calendar) {
    content.innerHTML = renderCalendar();
  } else if (reports) {
    content.innerHTML = renderDuties(page);
  } else {
    content.innerHTML = title('Życie na pokładzie', 'Aktywności załogi', 'Zaproponuj wydarzenie i znajdź termin, który pasuje wszystkim zapisanym.', 'event', 'Nowa aktywność') +
      `<div class="stats">${stat(allEvents().length, 'Aktywności')}${stat(allEvents().filter(event => event.votes[state.member]).length, 'Moje zapisy')}${stat(allEvents().filter(event => sharedSlots(event).length).length, 'Uzgodnione terminy')}</div>
      <section class="section"><h2>Wydarzenia na pokładzie</h2><div class="grid">${allEvents().map(eventCard).join('') || '<p class="empty">Brak aktywności.</p>'}</div></section>`;
  }
}

function save(message) {
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
  dialog.showModal();
}

function editUserProfile() {
  const profile = state.userProfile;
  openForm(profile ? 'Edytuj profil' : 'Utwórz profil', `
    <label>Nazwa wyświetlana <input name="displayName" required maxlength="80" autocomplete="nickname" value="${escape(profile?.name ?? '')}" autofocus></label>
    <label>Rola na pokładzie <input name="role" maxlength="60" value="${escape(profile?.role ?? '')}"></label>
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
    <label>Pytanie na przełamanie lodów <input name="icebreaker" maxlength="120" placeholder="Np. Jaki port chcesz odwiedzić ponownie?" value="${escape(profile?.icebreaker ?? '')}"></label>`, 'Zapisz profil', (data, form) => {
    const name = data.get('displayName').trim().replace(/\s+/gu, ' ');
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
    state.userProfile = {id, name, role, bio, interests, intent: data.get('intent'),
      gender: data.get('gender'), icebreaker: data.get('icebreaker').trim()};
    if (!existing) state.member = id;
    save('Zapisano profil.');
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
    save(eventsAvailable ? 'Zapisywanie wydarzenia na tablicy załogi…' : 'Zapisano wydarzenie w tej przeglądarce.');
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
  if (action === 'profile-edit') {
    editUserProfile();
    return;
  }
  if (action === 'profile-use' && state.userProfile) {
    state.member = state.userProfile.id;
    save('Wybrano Twój profil.');
    content.querySelector('[data-action="profile-edit"]')?.focus();
    return;
  }
  if (action === 'go-online' && state.userProfile) {
    state.member = state.userProfile.id;
    save();
    updateNetwork();
    void refreshDiscovery();
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
  if (action === 'demo-reset' && !personalDiscovery()) {
    if (window.confirm('Usunąć polubienia, pominięcia i dopasowania aktywnego profilu demo? Wiadomości zostaną zachowane.')) {
      delete state.crewConnections?.[state.member];
      save('Usunięto historię dopasowań profilu demo.');
      content.querySelector('[data-action="demo-reset"]')?.focus();
    }
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
  if (action === 'crew-revisit') {
    const choices = state.crewConnections[state.member];
    for (const profile of currentRoster().filter(matchesDiscoveryFilters)) {
      const key = profileId(profile);
      if (choices[key] === 'skip') delete choices[key];
    }
    save('Ponownie wyświetlono pominięte profile.');
    content.querySelector('[data-action="crew-skip"]')?.focus();
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
  if (event.target.id === 'duty-profile') {
    changeDutyProfile(event.target.value);
    return;
  }
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

member.addEventListener('change', () => {
  state.member = member.value;
  save();
  void refreshDiscovery();
});
function refreshPage() {
  render();
  void refreshDiscovery();
  if (isDutyPage()) void loadDuties();
}
window.addEventListener('hashchange', () => {
  refreshPage();
  if (isDutyPage()) window.scrollTo(0, 0);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isDutyPage()) void loadDuties();
});
window.addEventListener('storage', event => {
  if (event.key === storageKey && event.newValue) {
    state = JSON.parse(event.newValue);
    render();
  }
});
const updateNetwork = () => {
  const connectedProfile = isDutyPage() ? hostedDuties : state.userProfile?.id === state.member;
  document.querySelector('#network').textContent = connectedProfile ? (navigator.onLine ? 'Online' : 'Offline') :
    (navigator.onLine ? 'Tryb demo' : 'Demo · offline');
};
window.addEventListener('online', () => {
  updateNetwork();
  void syncWorkspace();
  if (isDutyPage()) void loadDuties();
});
window.addEventListener('offline', updateNetwork);
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  const install = document.querySelector('#install');
  install.hidden = false;
  install.onclick = async () => {
    install.hidden = true;
    await event.prompt();
  };
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.error);
member.innerHTML = crew.map(name => `<option>${escape(name)}</option>`).join('');
refreshPage();
void syncWorkspace();

void refreshEvents();
window.addEventListener('focus', refreshEvents);
window.addEventListener('focus', refreshDiscovery);
window.addEventListener('online', refreshDiscovery);
setInterval(() => { if (!document.hidden) void refreshDiscovery(); }, 3000);
window.addEventListener('online', refreshEvents);
setInterval(() => { if (!document.hidden) void refreshEvents(); }, 15000);

const mobileMenu = document.querySelector('.mobile-menu-toggle');
const navigation = document.querySelector('#mobile-navigation');
if (mobileMenu && navigation) {
  function setMenu(open) {
    mobileMenu.setAttribute('aria-expanded', String(open));
  }
  mobileMenu.addEventListener('click', () => setMenu(mobileMenu.getAttribute('aria-expanded') !== 'true'));
  navigation.addEventListener('click', event => {
    if (mobileMenu.getAttribute('aria-expanded') === 'true' && event.target.closest('a[href^="#"]')) {
      setMenu(false);
      mobileMenu.focus({preventScroll: true});
    }
  });
  window.addEventListener('hashchange', () => setMenu(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !dialog.open && mobileMenu.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      mobileMenu.focus();
    }
  });
}
