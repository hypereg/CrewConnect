const crew = ['Marek Nowak', 'Anna Kowalska', 'Piotr Zieliński'];
const storageKey = 'crewconnect-v1';
const dateValue = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};
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
const sharedSlots = event => participants(event).length < 2 ? [] : event.slots.filter(
  (_, index) => Object.values(event.votes).every(vote => vote.includes(index))
).sort();
const otherPage = () => location.hash === '#raporty';
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
    <p class="muted">${people.length} zapisanych${people.length ? ' · ' + escape(people.join(', ')) : ''}</p>
    <footer><button class="primary" data-action="vote" data-id="${event.id}">${event.votes[state.member] ? 'Zmień dostępność' : 'Zapisz się'}</button>
    ${event.votes[state.member] && event.owner !== state.member ? `<button class="secondary" data-action="leave" data-id="${event.id}">Wypisz się</button>` : ''}</footer>
  </article>`;
}

function render() {
  const reports = otherPage();
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === (reports ? 'raporty' : 'aktywnosci')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  member.value = state.member;
  if (reports) {
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

function createEvent() {
  openForm('Nowa aktywność', `
    <label>Nazwa <input name="title" maxlength="90" required></label>
    <label>Kategoria <select name="type"><option>Gry</option><option>Trening</option><option>Integracja</option><option>Inne</option></select></label>
    <label>Opis <textarea name="description" maxlength="500"></textarea></label>
    <label>Pierwszy termin <input type="datetime-local" name="slot" required></label>
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
      type: data.get('type'), description: data.get('description').trim(), slots,
      votes: {[state.member]: slots.map((_, index) => index)}});
    save('Dodano aktywność.');
  });
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
    event.votes[state.member] = selected;
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
  if (action === 'event') createEvent();
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
