const dutiesBase = document.querySelector('meta[name="crewconnect-api"]')?.content;
const dutySessionKey = 'crewconnect-duty-session:' + (dutiesBase || location.origin);
let hostedDuties = Boolean(dutiesBase || document.querySelector('meta[name="crewconnect-shared"]'));
let dutyServerConfigured = hostedDuties;
let demoVoiceEnabled = false;
let dutySession;
try {
  dutySession = JSON.parse(sessionStorage.getItem(dutySessionKey));
} catch {
  sessionStorage.removeItem(dutySessionKey);
}
const dutyStatuses = ['Wykonano', 'W trakcie', 'Wymaga uwagi'];
let schedule;
let scheduleError;
let scheduleRequest = 0;
let completionPending = false;
const dutyDisclosures = new Set();
const dutyPages = {
  raporty: 'Moje przydziały',
  'plan-zalogi': 'Plan załogi',
  'dziennik-raportow': 'Dziennik raportów'
};
const isDutyPage = (page = location.hash.slice(1)) => Object.hasOwn(dutyPages, page);

function demoSchedule() {
  state.duties ??= [
    {id: 'demo-watch', kind: 'Warta', title: 'Warta na mostku', assignee: crew[0], starts: dateValue() + 'T08:00', ends: dateValue() + 'T12:00'},
    {id: 'demo-mess', kind: 'Obowiązek', title: 'Przegląd wyposażenia kuchni', assignee: crew[1], starts: dateValue() + 'T13:00', ends: dateValue() + 'T14:00'},
    {id: 'demo-night', kind: 'Warta', title: 'Warta nocna', assignee: crew[2], starts: dateValue() + 'T22:00', ends: dateValue(1) + 'T02:00'}
  ];
  return {
    user: {id: state.member, name: state.member},
    members: crew.map(name => ({id: name, name})),
    duties: state.duties, reports: state.reports, voiceEnabled: demoVoiceEnabled
  };
}

function currentSchedule() {
  return hostedDuties ? schedule : demoSchedule();
}

async function dutyRequest(path, data, signal, session = dutySession) {
  const wav = data instanceof Blob;
  const headers = {};
  if (session) {
    const credentials = new TextEncoder().encode(session.member + ':' + session.password);
    headers.Authorization = 'Basic ' + btoa(String.fromCharCode(...credentials));
  }
  const options = {cache: 'no-store', signal, headers};
  if (data !== undefined) {
    headers['Content-Type'] = wav ? 'audio/wav' : 'application/json';
    options.method = 'POST';
    options.body = wav ? data : JSON.stringify(data);
  }
  const url = dutiesBase ? new URL(path, dutiesBase) : new URL(path.slice(1), location.href);
  const response = await fetch(url, options).catch(() => {
    throw new Error('Sprawdź połączenie z internetem i spróbuj ponownie.');
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw Object.assign(new Error(result?.error || 'Operacja jest chwilowo niedostępna.'), {
      status: response.status, apiError: typeof result?.error === 'string'
    });
  }
  return result;
}

async function loadDuties(refreshNotice) {
  if (!dutyServerConfigured && !['https:', 'http:'].includes(location.protocol)) return;
  const request = ++scheduleRequest;
  try {
    const next = await dutyRequest('/api/duties');
    if (request !== scheduleRequest) return;
    if (next.demo !== true && (!next.user || !Array.isArray(next.duties))) {
      throw new Error('Serwer zwrócił nieprawidłowy harmonogram.');
    }
    dutyServerConfigured = true;
    hostedDuties = !next.demo;
    if (next.demo) {
      demoVoiceEnabled = Boolean(next.voiceEnabled);
    } else {
      schedule = next;
      if (dutySession && dutySession.member !== next.user.id) storeDutySession(dutySession.password, next.user.id);
    }
    scheduleError = null;
    if (refreshNotice) announce('Harmonogram odświeżony.');
  } catch (error) {
    if (request !== scheduleRequest) return;
    if (!dutyServerConfigured && !error.apiError) return;
    dutyServerConfigured = true;
    scheduleError = error;
    if (error.status === 401) {
      hostedDuties = true;
      schedule = null;
      clearDutySession();
    }
  }
  if (isDutyPage()) render();
}

function storeDutySession(password, member) {
  dutySession = {password, member};
  sessionStorage.setItem(dutySessionKey, JSON.stringify(dutySession));
}

function clearDutySession() {
  dutySession = null;
  sessionStorage.removeItem(dutySessionKey);
}

function signInDuty() {
  openForm('Zaloguj do harmonogramu', `
    <label>Wspólne hasło załogi <input type="password" name="password" required maxlength="150" autocomplete="current-password"></label>`,
  'Zaloguj się', async fields => {
    const password = fields.get('password');
    const next = await dutyRequest('/api/duties', undefined, undefined, {member: '', password});
    if (!next.user) throw new Error('Wspólny harmonogram jest niedostępny.');
    ++scheduleRequest;
    const preferred = next.members.find(person => person.name === state.member);
    const selected = preferred || next.user;
    storeDutySession(password, selected.id);
    schedule = {...next, user: selected};
    scheduleError = null;
    render();
  });
}

function signOutDuty() {
  ++scheduleRequest;
  clearDutySession();
  schedule = null;
  scheduleError = Object.assign(new Error('Zaloguj się hasłem załogi, aby zobaczyć harmonogram.'), {status: 401});
  render();
}

function changeDutyProfile(id) {
  if (!hostedDuties && crew.includes(id)) {
    state.member = id;
    save();
    content.querySelector('#duty-profile')?.focus();
    return;
  }
  const person = schedule?.members.find(item => item.id === id);
  if (!person || !dutySession) return;
  ++scheduleRequest;
  storeDutySession(dutySession.password, id);
  schedule.user = person;
  render();
  content.querySelector('#duty-profile')?.focus();
}

const dutyPerson = (data, id) => escape(data.members.find(person => person.id === id)?.name || id);
const dutyTime = value => value.slice(11, 16);
const dutyDate = value => dayLabel.format(new Date(value + 'T12:00'));
const dutyDateTime = date => calendarDate(date) + 'T' + date.toTimeString().slice(0, 5);
const dutyShortDate = new Intl.DateTimeFormat('pl-PL', {day: 'numeric', month: 'long'});

function dutyDayLabel(day) {
  const relative = day === dateValue() ? 'Dzisiaj' : day === dateValue(1) ? 'Jutro' : '';
  if (relative) return relative + ', ' + dutyShortDate.format(new Date(day + 'T12:00'));
  return dutyDate(day);
}

function dutyHours(duty) {
  const nextDay = duty.starts.slice(0, 10) !== duty.ends.slice(0, 10);
  const endDay = nextDay ? ' (' + dutyShortDate.format(new Date(duty.ends.slice(0, 10) + 'T12:00')) + ')' : '';
  return `<time datetime="${duty.starts}">${dutyTime(duty.starts)}</time> – <time datetime="${duty.ends}">${dutyTime(duty.ends)}${endDay}</time>`;
}

function dutyRow(duty, data, report, {spotlight, editable = false} = {}) {
  const id = escape(duty.id);
  const own = duty.assignee === data.user.id;
  const heading = spotlight ? 'h2' : editable ? 'h3' : 'h4';
  const isWatch = duty.kind === 'Warta';
  return `<article class="duty-row${spotlight ? ' duty-spotlight' : ''}${editable ? ' duty-row-plan' : ''}">
    ${spotlight ? `<p class="duty-spotlight-label">${spotlight}</p>` : ''}
    <div class="duty-row-main">
      <div class="duty-details">
        <p class="duty-kind${isWatch ? ' duty-kind-watch' : ''}">${escape(duty.kind)}</p>
        <${heading}>${escape(duty.title)}</${heading}>
        ${editable ? `<p class="duty-person">${dutyPerson(data, duty.assignee)}${own ? ' · Ty' : ''}</p>` : ''}
      </div>
      <div class="duty-time">
        ${spotlight ? `<div class="duty-spotlight-date">${dutyDayLabel(duty.starts.slice(0, 10))}</div>` : ''}
        ${dutyHours(duty)}
      </div>
    </div>
    <div class="duty-row-footer">
      <div class="duty-statuses">
        <span class="duty-status${duty.completed ? ' duty-status-done' : ''}">${duty.completed ? 'Wykonano' : 'Do wykonania'}</span>
        ${report ? '<span class="duty-status duty-status-done">Raport zapisany</span>' :
          duty.completed && !spotlight ? '<span class="duty-status duty-status-waiting">Do złożenia raportu</span>' : ''}
      </div>
      <div class="duty-controls">
        ${!editable ? `<button class="${duty.completed || !spotlight ? 'secondary' : 'primary'}" data-action="duty-complete" data-id="${id}"
          ${completionPending ? 'disabled' : ''}>${duty.completed ? 'Cofnij wykonanie' : 'Oznacz wykonanie'}</button>
          <button class="${duty.completed && !report ? 'primary' : 'secondary'}" data-action="duty-report" data-id="${id}">${report ? 'Edytuj raport' : 'Złóż raport'}</button>` :
          `<button class="duty-quiet" data-action="duty-edit" data-id="${id}">Edytuj przydział</button>`}
      </div>
    </div>
  </article>`;
}

function reportCard(report, owner, editable, local = false) {
  const statusClass = report.status === 'Wykonano' ? ' duty-status-done' :
    report.status === 'Wymaga uwagi' ? ' duty-status-waiting' : '';
  return `<article class="duty-report">
    <header><div><h3>${escape(report.title)}</h3>
      <p class="duty-person"><time datetime="${escape(report.date)}">${formatDate(report.date)}</time> · ${owner}</p></div>
      <span class="duty-status${statusClass}">${escape(report.status)}</span>
    </header>
    ${report.notes ? `<p class="report-notes">${escape(report.notes)}</p>` : ''}
    ${editable ? `<footer><button class="duty-quiet" data-action="${local ? 'local-report' : 'report'}" data-id="${escape(report.id)}">Edytuj raport</button></footer>` : ''}
  </article>`;
}

function dutyDays(items, data, byDuty, editable = false) {
  const groups = new Map();
  const heading = editable ? 'h2' : 'h3';
  for (const duty of items) {
    const day = duty.starts.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(dutyRow(duty, data, byDuty.get(duty.id), {editable}));
  }
  return [...groups].map(([day, rows]) => `<div class="duty-day">
    <${heading}><time datetime="${day}">${dutyDayLabel(day)}</time></${heading}><div class="duty-list">${rows.join('')}</div></div>`).join('');
}

function dutyDisclosure(id, label, count, contents) {
  if (!count) return '';
  return `<details class="duty-disclosure" data-duty-disclosure="${id}"${dutyDisclosures.has(id) ? ' open' : ''}>
    <summary>${label} <span>(${count})</span></summary>${contents}</details>`;
}

function localDutyHistory() {
  if (!hostedDuties) return '';
  return dutyDisclosure('browser-reports', 'Raporty w tej przeglądarce', state.reports.length,
    `<div class="duty-report-list">${state.reports.map(report =>
      reportCard(report, escape(report.owner), report.owner === state.member, true)
    ).join('')}</div>`);
}

function myDutyPanel(data, ordered, byDuty, now) {
  const mine = ordered.filter(duty => duty.assignee === data.user.id);
  const active = mine.find(duty => !duty.completed && duty.starts <= now && duty.ends > now);
  const awaitingReport = mine.findLast(duty => duty.completed && !byDuty.has(duty.id));
  const upcoming = mine.find(duty => !duty.completed && duty.starts > now);
  const featured = active || awaitingReport || upcoming;
  const label = active ? 'Bieżący przydział' : awaitingReport ? 'Raport do złożenia' : 'Najbliższy przydział';
  const rest = mine.filter(duty => duty !== featured);
  const resolved = duty => duty.completed && byDuty.has(duty.id);
  const done = rest.filter(resolved).reverse();
  const followUp = rest.filter(duty => !resolved(duty) && (duty.completed || duty.ends <= now)).reverse();
  const later = rest.filter(duty => !duty.completed && duty.ends > now);
  return `<section class="duty-panel" aria-labelledby="duty-page-title">
    <p class="duty-panel-meta">Godziny pokładowe</p>
    ${featured ? dutyRow(featured, data, byDuty.get(featured.id), {spotlight: label}) : ''}
    ${followUp.length ? `<div class="duty-group"><h2 class="duty-group-label">Do uzupełnienia</h2>${dutyDays(followUp, data, byDuty)}</div>` : ''}
    ${later.length ? `<div class="duty-group"><h2 class="duty-group-label">Kolejne przydziały</h2>${dutyDays(later, data, byDuty)}</div>` : ''}
    ${!featured && !followUp.length && !later.length ? `<div class="duty-empty"><p>${done.length ? 'Wszystkie Twoje przydziały są rozliczone.' : 'Nie masz jeszcze przydziałów.'}</p>
      <a class="secondary" href="#plan-zalogi">Zobacz plan załogi</a></div>` : ''}
    ${dutyDisclosure('completed', 'Rozliczone przydziały', done.length, dutyDays(done, data, byDuty))}
  </section>`;
}

function crewPlanPanel(data, ordered, byDuty, now) {
  const today = now.slice(0, 10);
  const current = ordered.filter(duty => duty.ends.slice(0, 10) >= today);
  const past = ordered.filter(duty => duty.ends.slice(0, 10) < today).reverse();
  return `<section class="duty-panel" aria-labelledby="duty-page-title">
    <header class="duty-panel-head"><p class="duty-panel-meta">Godziny pokładowe</p>
      <button class="primary" data-action="duty-edit">+ Dodaj przydział</button>
    </header>
    ${current.length ? dutyDays(current, data, byDuty, true) : '<div class="duty-empty"><p>Brak przydziałów na dziś i kolejne dni.</p></div>'}
    ${dutyDisclosure('past', 'Wcześniejsze przydziały', past.length, dutyDays(past, data, byDuty, true))}
  </section>`;
}

function dutyJournal(data) {
  const reports = [...data.reports].sort((a, b) => b.date.localeCompare(a.date)).map(report =>
    reportCard(report, dutyPerson(data, report.owner), report.owner === data.user.id)
  ).join('');
  return `<section class="duty-panel" aria-labelledby="duty-page-title">
    <header class="duty-panel-head duty-panel-end">
      <button class="secondary" data-action="report">+ Raport bez przydziału</button>
    </header>
    ${reports ? `<div class="duty-report-list">${reports}</div>` : '<div class="duty-empty"><p>Nie zapisano jeszcze żadnego raportu.</p></div>'}
    ${localDutyHistory()}
  </section>`;
}

function renderDuties(page) {
  const data = currentSchedule();
  const heading = `<h1 id="duty-page-title">${dutyPages[page]}</h1>`;
  const notice = scheduleError && `<div class="duty-message"><p role="status">${escape(scheduleError.message)}</p>
    ${scheduleError.status === 401 ? '<button class="primary" data-action="duty-login">Zaloguj się</button>' :
      '<button class="secondary" data-action="duty-refresh">Spróbuj ponownie</button>'}</div>`;
  if (!data) {
    return `<div class="duties-page"><header class="duties-heading">${heading}</header>
      ${notice || '<p role="status">Wczytywanie harmonogramu…</p>'}${localDutyHistory()}</div>`;
  }
  const now = dutyDateTime(new Date());
  const ordered = [...data.duties].sort((a, b) => a.starts.localeCompare(b.starts));
  const byDuty = new Map(data.reports.filter(report => report.dutyId).map(report => [report.dutyId, report]));
  const panel = page === 'raporty' ? myDutyPanel(data, ordered, byDuty, now) :
    page === 'plan-zalogi' ? crewPlanPanel(data, ordered, byDuty, now) : dutyJournal(data);
  return `<div class="duties-page">
    <header class="duties-heading">${heading}
      <div class="duty-account">
        <label class="duty-profile">Profil załogi
          <select id="duty-profile">${data.members.map(person => `<option value="${escape(person.id)}"${person.id === data.user.id ? ' selected' : ''}>${escape(person.name)}</option>`).join('')}</select>
        </label>
        ${hostedDuties ? '<button class="duty-quiet" data-action="duty-refresh">Odśwież</button><button class="duty-quiet" data-action="duty-logout">Wyloguj</button>' : ''}
      </div>
    </header>
    ${notice || ''}
    ${panel}
  </div>`;
}

function editDuty(data, duty) {
  const id = duty?.id || crypto.randomUUID();
  const assigned = duty?.assignee || data.user.id;
  const hasReport = data.reports.some(report => report.dutyId === id);
  const locked = duty?.completed || hasReport;
  const nextHour = new Date();
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
  const start = duty?.starts || dutyDateTime(nextHour);
  nextHour.setHours(nextHour.getHours() + 1);
  const end = duty?.ends || dutyDateTime(nextHour);
  openForm(duty ? 'Edytuj przydział' : 'Nowy przydział', `
    <label>Rodzaj <select name="kind">${['Warta', 'Obowiązek'].map(kind =>
      `<option${duty?.kind === kind ? ' selected' : ''}>${kind}</option>`
    ).join('')}</select></label>
    <label>Nazwa <input name="title" maxlength="100" required value="${escape(duty?.title || '')}"></label>
    <label>Osoba <select name="assignee" ${locked ? 'disabled' : ''}>${data.members.map(person =>
      `<option value="${escape(person.id)}"${assigned === person.id ? ' selected' : ''}>${escape(person.name)}</option>`
    ).join('')}</select></label>
    <div class="duty-dates">
      <label>Początek <input name="starts" type="datetime-local" required value="${start}"></label>
      <label>Koniec <input name="ends" type="datetime-local" required value="${end}"></label>
    </div>`, 'Zapisz przydział', async fields => {
    const payload = {...Object.fromEntries(fields), id, assignee: locked ? assigned : fields.get('assignee'), title: fields.get('title').trim()};
    if (!payload.title) throw new Error('Wpisz nazwę przydziału.');
    if (payload.ends <= payload.starts) throw new Error('Koniec musi wypadać po rozpoczęciu przydziału.');
    if (hostedDuties) {
      await dutyRequest('/api/duties', payload);
      await loadDuties();
      announce('Zapisano przydział.');
    } else {
      const list = demoSchedule().duties;
      const current = list.find(item => item.id === id);
      if (current) {
        if ((current.completed || state.reports.some(item => item.dutyId === id)) && current.assignee !== payload.assignee) {
          throw new Error('Ten przydział ma już wykonanie lub raport.');
        }
        Object.assign(current, payload);
        const linked = state.reports.find(item => item.dutyId === id);
        if (linked) Object.assign(linked, {title: current.title, date: current.starts.slice(0, 10)});
      } else {
        list.push(payload);
      }
      save('Zapisano przydział.');
    }
  });
}

function editDutyReport(data, report, duty, local = false) {
  const id = duty?.id || report?.id || crypto.randomUUID();
  const reportTitle = duty?.title || report?.title || '';
  const day = duty?.starts.slice(0, 10) || report?.date || dateValue();
  const voiceEnabled = Boolean((data || currentSchedule())?.voiceEnabled);
  const voiceUnavailable = !dutyServerConfigured ? 'Raport głosowy wymaga połączenia z serwerem CrewConnect.' :
    hostedDuties ? (schedule ? 'Na serwerze trzeba ustawić klucz NVIDIA, aby włączyć raporty głosowe.' :
      'Zaloguj się do harmonogramu załogi, aby nagrać raport.') :
    'Raport głosowy wymaga konfiguracji NVIDIA i hasła załogi na serwerze.';
  openForm(report ? 'Edytuj raport' : duty ? 'Złóż raport z przydziału' : 'Raport bez przydziału', `
    ${duty ? `<div class="duty-report-context"><strong>${escape(duty.title)}</strong><span>${dutyDayLabel(day)} · ${dutyHours(duty)}</span></div>` : `
      <label>Obowiązek <input name="title" required maxlength="100" value="${escape(reportTitle)}"></label>
      <label>Data <input name="date" type="date" required value="${escape(day)}"></label>`}
    ${voiceFields(voiceEnabled, voiceUnavailable, !hostedDuties)}
    <label>Treść raportu <textarea name="notes" rows="4" maxlength="1000">${escape(report?.notes || '')}</textarea></label>
    <label>Status obowiązku <select name="status">${dutyStatuses.map(status =>
      `<option${status === (report?.status || (duty && !duty.completed ? 'W trakcie' : 'Wykonano')) ? ' selected' : ''}>${status}</option>`
    ).join('')}</select></label>`,
  'Zapisz raport', async fields => {
    const title = (duty ? reportTitle : fields.get('title')).trim();
    if (!title) throw new Error('Wpisz nazwę obowiązku.');
    const payload = {id, dutyId: duty?.id || report?.dutyId || null, title, date: duty ? day : fields.get('date'),
      status: fields.get('status'), notes: fields.get('notes').trim()};
    if (hostedDuties && !local) {
      await dutyRequest('/api/reports', payload);
      await loadDuties();
      announce('Zapisano raport.');
    } else {
      const current = state.reports.find(item => item.id === id);
      const currentDuty = duty && demoSchedule().duties.find(item => item.id === duty.id);
      if ((current && current.owner !== state.member) || (duty && currentDuty?.assignee !== state.member)) {
        throw new Error('Ten raport nie należy do Ciebie.');
      }
      if (currentDuty) Object.assign(payload, {title: currentDuty.title, date: currentDuty.starts.slice(0, 10)});
      if (current) Object.assign(current, payload);
      else state.reports.unshift({...payload, owner: state.member});
      save('Zapisano raport.');
    }
  });
  if (voiceEnabled) bindVoice(dialog.querySelector('form'));
}

async function handleDutyAction(button) {
  const {action, id} = button.dataset;
  if (action === 'duty-login') return signInDuty();
  if (action === 'duty-logout') return signOutDuty();
  if (action === 'duty-refresh') {
    await loadDuties(true);
    return;
  }
  if (action === 'local-report') {
    const report = state.reports.find(item => item.id === id && item.owner === state.member);
    const duty = state.duties?.find(item => item.id === report?.dutyId);
    if (report) editDutyReport(null, report, duty, true);
    return;
  }
  const data = currentSchedule();
  if (!data) return;
  const duty = data.duties.find(item => item.id === id);
  const report = data.reports.find(item => item.owner === data.user.id && item.dutyId === duty?.id);
  if (action === 'duty-edit' && (!id || duty)) editDuty(data, duty);
  if (action === 'report') {
    const existing = data.reports.find(item => item.id === id && item.owner === data.user.id);
    const related = data.duties.find(item => item.id === existing?.dutyId);
    if (!id || existing) editDutyReport(data, existing, related);
  }
  if (duty?.assignee !== data.user.id) return;
  if (action === 'duty-report') editDutyReport(data, report, duty);
  if (action !== 'duty-complete' || completionPending) return;
  const completed = !duty.completed;
  const message = completed ? 'Oznaczono jako wykonane.' : 'Cofnięto wykonanie.';
  if (!hostedDuties) {
    duty.completed = completed;
    save(message);
  } else {
    completionPending = true;
    render();
    try {
      await dutyRequest('/api/duties/completion', {id, completed});
      await loadDuties();
      announce(message);
    } catch (error) {
      announce(error.message);
    } finally {
      completionPending = false;
      render();
    }
  }
  const control = content.querySelector(`[data-action="duty-complete"][data-id="${CSS.escape(id)}"]`);
  const collapsed = control?.closest('details:not([open])');
  (collapsed?.querySelector('summary') || control)?.focus();
}
