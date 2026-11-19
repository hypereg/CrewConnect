const dutiesBase = document.querySelector('meta[name="crewconnect-api"]')?.content;
const dutySessionKey = 'crewconnect-duty-session:' + (dutiesBase || location.origin);
let hostedDuties = Boolean(dutiesBase || document.querySelector('meta[name="crewconnect-shared"]'));
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
let dutyFilter = 'all';
let completionPending = false;

function demoSchedule() {
  state.duties ??= [
    {id: 'demo-watch', kind: 'Warta', title: 'Warta na mostku', assignee: crew[0], starts: dateValue() + 'T08:00', ends: dateValue() + 'T12:00'},
    {id: 'demo-mess', kind: 'Obowiązek', title: 'Przegląd wyposażenia kuchni', assignee: crew[1], starts: dateValue() + 'T13:00', ends: dateValue() + 'T14:00'},
    {id: 'demo-night', kind: 'Warta', title: 'Warta nocna', assignee: crew[2], starts: dateValue() + 'T22:00', ends: dateValue(1) + 'T02:00'}
  ];
  return {
    user: {id: state.member, name: state.member},
    members: crew.map(name => ({id: name, name})),
    duties: state.duties, reports: state.reports, voiceEnabled: false
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
  const url = dutiesBase ? new URL(path, dutiesBase).href : path;
  const response = await fetch(url, options).catch(() => {
    throw new Error('Sprawdź połączenie z internetem i spróbuj ponownie.');
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw Object.assign(new Error(result?.error || 'Operacja jest chwilowo niedostępna.'), {status: response.status});
  }
  return result;
}

async function loadDuties(refreshNotice) {
  if (!hostedDuties) return;
  const request = ++scheduleRequest;
  try {
    const next = await dutyRequest('/api/duties');
    if (request !== scheduleRequest) return;
    if (next.demo) {
      hostedDuties = false;
    } else {
      schedule = next;
      if (dutySession && dutySession.member !== next.user.id) storeDutySession(dutySession.password, next.user.id);
    }
    scheduleError = null;
    if (refreshNotice) showNotice('Harmonogram odświeżony.');
  } catch (error) {
    if (request !== scheduleRequest) return;
    scheduleError = error;
    if (error.status === 401) {
      schedule = null;
      dutySession = null;
      sessionStorage.removeItem(dutySessionKey);
    }
  }
  if (location.hash === '#raporty') render();
}

function storeDutySession(password, member) {
  dutySession = {password, member};
  sessionStorage.setItem(dutySessionKey, JSON.stringify(dutySession));
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
  dutySession = null;
  schedule = null;
  sessionStorage.removeItem(dutySessionKey);
  scheduleError = Object.assign(new Error('Zaloguj się hasłem załogi, aby zobaczyć harmonogram.'), {status: 401});
  render();
}

function changeDutyProfile(id) {
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

function dutyHours(duty) {
  const nextDay = duty.starts.slice(0, 10) !== duty.ends.slice(0, 10);
  const end = (nextDay ? formatDate(duty.ends.slice(0, 10)) + ' ' : '') + dutyTime(duty.ends);
  return `<time datetime="${duty.starts}">${dutyTime(duty.starts)}</time>–<time datetime="${duty.ends}">${end}</time>`;
}

function dutyRow(duty, data, report) {
  const id = escape(duty.id);
  const own = duty.assignee === data.user.id;
  return `<article class="duty-row${own ? ' duty-own' : ''}">
    <div class="duty-time">${dutyHours(duty)}</div>
    <div class="duty-details"><span class="duty-kind">${escape(duty.kind)}</span>
      <h3>${escape(duty.title)}</h3><p>${dutyPerson(data, duty.assignee)}${own ? ' · Ty' : ''}</p></div>
    <div class="duty-controls">
      <span class="badge ${duty.completed ? '' : 'duty-planned'}">${duty.completed ? 'Wykonano' : 'Do wykonania'}</span>
      ${report ? '<span class="duty-report-state">Raport zapisany</span>' : ''}
      ${own ? `<button class="secondary" data-action="duty-complete" data-id="${id}" aria-pressed="${Boolean(duty.completed)}"
        ${completionPending ? 'disabled' : ''}>${duty.completed ? 'Cofnij wykonanie' : 'Oznacz wykonanie'}</button>
        <button class="secondary" data-action="duty-report" data-id="${id}">${report ? 'Edytuj raport' : 'Dodaj raport'}</button>` : ''}
      <button class="secondary" data-action="duty-edit" data-id="${id}">Edytuj przydział</button>
    </div></article>`;
}

function reportCard(report, owner, editable, local = false) {
  return `<article class="card">
    <span class="badge">${escape(report.status)}</span><h3>${escape(report.title)}</h3>
    <p class="muted">${formatDate(report.date)} · ${owner}</p>
    ${report.notes ? `<p class="report-notes">${escape(report.notes)}</p>` : ''}
    ${editable ? `<footer><button class="secondary" data-action="${local ? 'local-report' : 'report'}" data-id="${escape(report.id)}">Edytuj raport</button></footer>` : ''}
  </article>`;
}

function renderDuties() {
  const data = currentSchedule();
  const localReports = hostedDuties ? state.reports : [];
  const localHistory = localReports.length ? `<section class="section"><h2>Raporty w tej przeglądarce</h2><div class="grid">${localReports.map(
    report => reportCard(report, escape(report.owner), report.owner === state.member, true)
  ).join('')}</div></section>` : '';
  const notice = scheduleError ? `<div class="duty-message" role="status">${escape(scheduleError.message)}
    ${scheduleError.status === 401 ? '<button class="secondary" data-action="duty-login">Zaloguj się</button>' :
      '<button class="secondary" data-action="duty-refresh">Spróbuj ponownie</button>'}</div>` : '';
  const hero = title('Dziennik pokładowy', 'Raporty obowiązków', 'Sprawdź plan wart i obowiązków, oznacz wykonanie i złóż raport z dyżuru.', data && 'report', 'Dodaj raport');
  if (!data) {
    return hero + (notice || '<p role="status">Wczytywanie harmonogramu…</p>') + localHistory;
  }

  const groups = new Map();
  const byDuty = new Map(data.reports.filter(report => report.dutyId).map(report => [report.dutyId, report]));
  const ordered = [...data.duties].sort((a, b) => a.starts.localeCompare(b.starts));
  for (const duty of ordered) {
    if (dutyFilter === 'mine' && duty.assignee !== data.user.id) continue;
    const day = duty.starts.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(dutyRow(duty, data, byDuty.get(duty.id)));
  }
  const days = Array.from(groups, ([day, rows]) => `<section class="duty-day">
    <h3><time datetime="${day}">${dutyDate(day)}</time></h3><div class="card duty-list">${rows.join('')}</div></section>`).join('');
  const reports = [...data.reports].sort((a, b) => b.date.localeCompare(a.date)).map(report =>
    reportCard(report, dutyPerson(data, report.owner), report.owner === data.user.id)
  ).join('');
  return hero + notice + `
    <section class="section duty-schedule" aria-labelledby="duty-heading">
      <header class="duty-header"><div><h2 id="duty-heading">Harmonogram wart i obowiązków</h2>
        <p class="muted">${escape(data.user.name)} · godziny pokładowe${hostedDuties ? '' : ' · dane demonstracyjne'}</p></div>
        <div class="duty-actions">
          ${hostedDuties ? '<button class="secondary" data-action="duty-refresh">Odśwież</button>' : ''}
          <button class="primary" data-action="duty-edit">+ Dodaj przydział</button>
          ${hostedDuties ? '<button class="secondary" data-action="duty-logout">Wyloguj</button>' : ''}
        </div>
      </header>
      <div class="duty-filters" role="group" aria-label="Pokaż przydziały">
        ${hostedDuties ? `<label class="duty-profile" for="duty-profile">Twój profil
          <select id="duty-profile">${data.members.map(person => `<option value="${escape(person.id)}"${person.id === data.user.id ? ' selected' : ''}>${escape(person.name)}</option>`).join('')}</select>
        </label>` : ''}
        <button class="secondary" data-action="duty-filter" data-id="all" aria-pressed="${dutyFilter === 'all'}">Cała załoga</button>
        <button class="secondary" data-action="duty-filter" data-id="mine" aria-pressed="${dutyFilter === 'mine'}">Moje przydziały</button>
      </div>
      ${days || '<p class="empty">Brak przydziałów w tym widoku.</p>'}
    </section>
    <section class="section"><h2>Dziennik załogi</h2>
      <div class="stats">${stat(data.reports.length, 'Wszystkie raporty')}${stat(data.reports.filter(report => report.status === 'Wykonano').length, 'Wykonane')}${stat(data.reports.filter(report => report.status === 'Wymaga uwagi').length, 'Wymagają uwagi')}</div>
      <div class="grid">${reports || '<p class="empty">Brak raportów.</p>'}</div>
    </section>
    ${localHistory}`;
}

function editDuty(data, duty) {
  const id = duty?.id || crypto.randomUUID();
  const assigned = duty?.assignee || data.user.id;
  const hasReport = data.reports.some(report => report.dutyId === id);
  const locked = duty?.completed || hasReport;
  const start = duty?.starts || dateValue() + 'T08:00';
  const end = duty?.ends || dateValue() + 'T12:00';
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
      showNotice('Zapisano przydział.');
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
  openForm(report ? 'Edytuj raport' : 'Nowy raport', `
    ${duty ? `<div class="note"><strong>${escape(duty.title)}</strong><br>${dutyDate(day)} · ${dutyHours(duty)}</div>` : `
      <label>Obowiązek <input name="title" required maxlength="100" value="${escape(reportTitle)}"></label>
      <label>Data <input name="date" type="date" required value="${escape(day)}"></label>`}
    <label>Status <select name="status">${dutyStatuses.map(status =>
      `<option${status === (report?.status || (duty && !duty.completed ? 'W trakcie' : 'Wykonano')) ? ' selected' : ''}>${status}</option>`
    ).join('')}</select></label>
    ${!local && hostedDuties ? data?.voiceEnabled ? voiceFields() : '<p class="muted">Raport głosowy będzie dostępny po konfiguracji NVIDIA.</p>' : ''}
    <label>Treść raportu <textarea name="notes" rows="4" maxlength="1000">${escape(report?.notes || '')}</textarea></label>`,
  'Zapisz raport', async fields => {
    const title = (duty ? reportTitle : fields.get('title')).trim();
    if (!title) throw new Error('Wpisz nazwę obowiązku.');
    const payload = {id, dutyId: duty?.id || report?.dutyId || null, title, date: duty ? day : fields.get('date'),
      status: fields.get('status'), notes: fields.get('notes').trim()};
    if (hostedDuties && !local) {
      await dutyRequest('/api/reports', payload);
      await loadDuties();
      showNotice('Zapisano raport.');
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
  if (!local && data?.voiceEnabled) bindVoice(dialog.querySelector('form'));
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
  if (action === 'duty-filter') {
    dutyFilter = id;
    render();
    content.querySelector('[data-action="duty-filter"][aria-pressed="true"]')?.focus();
  }
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
      showNotice(message);
    } catch (error) {
      showNotice(error.message);
    } finally {
      completionPending = false;
      render();
    }
  }
  content.querySelector(`[data-action="duty-complete"][data-id="${CSS.escape(id)}"]`)?.focus();
}
