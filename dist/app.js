const crew = ['Marek Nowak', 'Anna Kowalska', 'Piotr Zieliński'];
const storageKey = 'crewconnect-v1';
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
const notice = document.querySelector('#notice');
let noticeTimer;
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
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
  const scheduled = state.events.flatMap(event => {
    const [slot] = sharedSlots(event);
    return slot ? [{event, slot}] : [];
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
      ${items.slice(0, 2).map(({event, slot}) => `<span class="calendar-event">${slot.slice(11, 16)} ${escape(event.title)}</span>`).join('')}
      ${items.length > 2 ? `<span class="calendar-more">+${items.length - 2}</span>` : ''}
    </button>`;
  }).join('');
  const agenda = eventsOn(selectedDay).map(({event, slot}) => `
    <article class="agenda-item"><time datetime="${slot}">${slot.slice(11, 16)}</time>
      <div><h3>${escape(event.title)}</h3><p class="muted">${escape(event.type)} · ${escape(event.owner)}</p></div>
      ${signupButton(event, 'secondary')}
    </article>`).join('');
  return `<section class="calendar" aria-labelledby="calendar-title">
    <header class="calendar-header"><div><h1 id="calendar-title">Kalendarz</h1><h2>${monthLabel.format(first)}</h2></div>
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
    ${agenda || '<p class="muted">Tego dnia nie ma uzgodnionych aktywności.</p>'}
  </section>`;
}
const stat = (count, label) => `<div class="stat"><b>${count}</b><span>${label}</span></div>`;
const title = (eyebrow, heading, description, action, label) => `
  <section class="hero"><div><span class="eyebrow">${eyebrow}</span><h1>${heading}</h1><p>${description}</p></div>
  <button class="primary" data-action="${action}">+ ${label}</button></section>`;

function eventCard(event) {
  const people = participants(event);
  const shared = sharedSlots(event);
  const summary = shared.length ? 'Wspólny termin: ' + formatDate(shared[0]) :
    people.length < 2 ? 'Potrzeba co najmniej dwóch uczestników.' : 'Brak wspólnego terminu.';
  return `<article class="card">
    <span class="badge">${escape(event.type)}</span>
    <h3>${escape(event.title)}</h3>
    <p class="muted">Organizuje ${escape(event.owner)}</p>
    ${event.description ? `<p>${escape(event.description)}</p>` : ''}
    <p class="note"><strong>${summary}</strong></p>
    <p class="muted">${people.length}${event.capacity ? ' / ' + event.capacity : ''} zapisanych${people.length ? ' · ' + escape(people.join(', ')) : ''}</p>
    <footer>${signupButton(event, 'primary')}
    ${event.votes[state.member] && event.owner !== state.member ? `<button class="secondary" data-action="leave" data-id="${event.id}">Wypisz się</button>` : ''}</footer>
  </article>`;
}

function render() {
  const page = location.hash.slice(1);
  const reports = page === 'raporty';
  const calendar = page === 'kalendarz';
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === (calendar || reports ? page : 'aktywnosci')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  member.value = state.member;
  if (calendar) {
    content.innerHTML = renderCalendar();
  } else if (reports) {
    const ordered = [...state.reports].sort((a, b) => b.date.localeCompare(a.date));
    content.innerHTML = title('Dziennik pokładowy', 'Raporty obowiązków', 'Zapisuj wykonane zadania i zgłaszaj, co wymaga dalszej pracy.', 'report', 'Dodaj raport') +
      `<div class="stats">${stat(ordered.length, 'Wszystkie raporty')}${stat(ordered.filter(report => report.status === 'Wykonano').length, 'Wykonane')}${stat(ordered.filter(report => report.status === 'Wymaga uwagi').length, 'Wymagają uwagi')}</div>
      <section class="section"><h2>Dziennik załogi</h2><div class="grid">${ordered.map(report => `<article class="card">
      <span class="badge">${escape(report.status)}</span><h3>${escape(report.title)}</h3>
      <p class="muted">${formatDate(report.date)} · ${escape(report.owner)}</p>
      ${report.notes ? `<p>${escape(report.notes)}</p>` : ''}
      ${report.owner === state.member ? `<footer><button class="secondary" data-action="report" data-id="${report.id}">Edytuj raport</button></footer>` : ''}</article>`).join('') || '<p class="empty">Brak raportów.</p>'}</div></section>`;
  } else {
    content.innerHTML = title('Życie na pokładzie', 'Aktywności załogi', 'Zaproponuj wydarzenie i znajdź termin, który pasuje wszystkim zapisanym.', 'event', 'Nowa aktywność') +
      `<div class="stats">${stat(state.events.length, 'Aktywności')}${stat(state.events.filter(event => event.votes[state.member]).length, 'Moje zapisy')}${stat(state.events.filter(event => sharedSlots(event).length).length, 'Uzgodnione terminy')}</div>
      <section class="section"><h2>Wydarzenia na pokładzie</h2><div class="grid">${state.events.map(eventCard).join('') || '<p class="empty">Brak aktywności.</p>'}</div></section>`;
  }
}

function save(message) {
  localStorage.setItem(storageKey, JSON.stringify(state));
  render();
  if (!message) return;
  clearTimeout(noticeTimer);
  notice.textContent = message;
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 3500);
}

function openForm(name, fields, submitLabel, onSubmit) {
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${name}</h2><button type="button" data-close class="secondary" aria-label="Zamknij">✕</button></div>
    <form>${fields}<button class="primary">${submitLabel}</button></form>`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault();
    if (onSubmit(new FormData(event.currentTarget), event.currentTarget) !== false) dialog.close();
  };
  dialog.showModal();
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
    state.events.unshift({id: crypto.randomUUID(), title: name, owner: state.member,
      type: data.get('type'), capacity: Number(data.get('capacity')), description: data.get('description').trim(), slots,
      votes: {[state.member]: slots.map((_, index) => index)}});
    save('Dodano aktywność.');
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
    const currentEvent = state.events.find(item => item.id === event.id);
    if (!currentEvent?.votes[state.member] && (!currentEvent || isFull(currentEvent))) {
      form.querySelector('[data-error]').textContent = 'Na tę aktywność nie ma już wolnych miejsc.';
      return false;
    }
    currentEvent.votes[state.member] = selected;
    save('Zapisano dostępność.');
  });
}

function editReport(report) {
  const statuses = ['Wykonano', 'W trakcie', 'Wymaga uwagi'];
  openForm(report ? 'Edytuj raport' : 'Nowy raport', `
    <label>Obowiązek <input name="title" required maxlength="100" value="${escape(report?.title || '')}"></label>
    <label>Data <input name="date" type="date" required value="${report?.date || dateValue()}"></label>
    <label>Status <select name="status">${statuses.map(status => `<option${status === report?.status ? ' selected' : ''}>${status}</option>`).join('')}</select></label>
    <label>Notatka <textarea name="notes" maxlength="1000">${escape(report?.notes || '')}</textarea></label>`,
    'Zapisz raport', (data, form) => {
      const name = data.get('title').trim();
      if (!name) {
        const input = form.elements.title;
        input.setCustomValidity('Wpisz nazwę obowiązku.');
        input.reportValidity();
        input.addEventListener('input', () => input.setCustomValidity(''), {once: true});
        return false;
      }
      const fields = {title: name, date: data.get('date'), status: data.get('status'), notes: data.get('notes').trim()};
      if (report) Object.assign(report, fields);
      else state.reports.unshift({id: crypto.randomUUID(), owner: state.member, ...fields});
      save('Zapisano raport.');
    });
}

content.addEventListener('click', e => {
  const button = e.target.closest('button[data-action]');
  if (!button) return;
  const {action, id} = button.dataset;
  const event = state.events.find(item => item.id === id);
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
  if (action === 'vote' && event) vote(event);
  if (action === 'leave' && event && event.owner !== state.member) {
    delete event.votes[state.member];
    save('Wypisano Cię z aktywności.');
  }
  if (action === 'report') editReport(state.reports.find(item => item.id === id && item.owner === state.member));
});
member.addEventListener('change', () => {
  state.member = member.value;
  save();
});
window.addEventListener('hashchange', render);
window.addEventListener('storage', event => {
  if (event.key === storageKey && event.newValue) {
    state = JSON.parse(event.newValue);
    render();
  }
});
const updateNetwork = () => {
  document.querySelector('#network').textContent = navigator.onLine ? 'Tryb demo' : 'Demo · offline';
};
window.addEventListener('online', updateNetwork);
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
updateNetwork();
render();
