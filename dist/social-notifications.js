const time = new Intl.DateTimeFormat('pl-PL', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
const actionNames = {readAll: 'readAllNotifications', clear: 'clearNotifications'};

export function createSocialNotifications({menu, request, openItem, announce, escape}) {
  const summary = menu.querySelector('summary');
  const badge = menu.querySelector('[data-unread]');
  const list = menu.querySelector('.notification-list');
  const readAll = menu.querySelector('[data-notification-action="readAll"]');
  const clear = menu.querySelector('[data-notification-action="clear"]');
  let context;

  function render() {
    const items = context?.board?.items ?? [];
    const unread = items.filter(item => item.unread).length;
    badge.textContent = String(unread);
    badge.hidden = !unread;
    summary.setAttribute('aria-label', unread ? `Powiadomienia, nieprzeczytane: ${unread}` : 'Powiadomienia');
    const html = items.length ? items.map(item => `
      <button type="button" class="notification-item${item.unread ? ' unread' : ''}" data-notification-id="${escape(item.id)}">
        <span class="notification-symbol" aria-hidden="true">${item.kind === 'message' ? '✉' : '▦'}</span>
        <span><strong>${item.kind === 'message' ? 'Wiadomość od ' : 'Nowa aktywność: '}${escape(item.title)}</strong>
          <time datetime="${escape(item.at)}">${time.format(new Date(item.at))}</time>
        </span>
        ${item.unread ? '<span class="notification-dot" aria-label="Nieprzeczytane"></span>' : ''}
      </button>`).join('') : `<p>${context?.error ? escape(context.error) :
        context?.board ? 'Brak powiadomień.' : 'Wczytywanie powiadomień…'}</p>`;
    if (list.dataset.markup !== html) {
      const activeId = list.contains(document.activeElement) ? document.activeElement.dataset.notificationId : null;
      list.innerHTML = html;
      list.dataset.markup = html;
      if (activeId) {
        const active = [...list.querySelectorAll('[data-notification-id]')].find(item => item.dataset.notificationId === activeId);
        (active ?? summary).focus({preventScroll: true});
      }
    }
    readAll.disabled = !unread || Boolean(context?.saving);
    clear.disabled = !items.length || Boolean(context?.saving);
  }

  async function load() {
    const owner = context;
    if (!owner || owner.loading || owner.saving || document.hidden) return;
    owner.loading = true;
    const version = owner.version;
    try {
      const board = await request(null, '?notifications=1');
      if (context === owner && owner.version === version) {
        owner.board = board;
        owner.error = '';
      }
    } catch {
      if (context === owner && owner.version === version) owner.error = 'Powiadomienia są chwilowo niedostępne.';
    } finally {
      owner.loading = false;
      if (context === owner) render();
    }
  }

  function showFor(key) {
    if (context?.key === key) return;
    context = key ? {key, version: 0} : undefined;
    menu.open = false;
    menu.hidden = !context;
    render();
    void load();
  }

  menu.addEventListener('toggle', () => { if (menu.open) void load(); });
  menu.addEventListener('click', async event => {
    const control = event.target.closest('button');
    const owner = context;
    if (!control || !owner?.board) return;
    const item = owner.board.items.find(entry => entry.id === control.dataset.notificationId);
    if (item) {
      menu.open = false;
      summary.focus({preventScroll: true});
      void openItem(item);
    }
    const action = actionNames[control.dataset.notificationAction];
    if (owner.saving || (!action && !item?.unread)) return;
    owner.saving = true;
    owner.version++;
    render();
    try {
      const board = await request(action ? {action, through: owner.board.through} : {action: 'readNotification', id: item.id});
      if (context === owner) owner.board = board;
    } catch (error) {
      if (context === owner) announce(error.message);
    } finally {
      owner.saving = false;
      if (context === owner) render();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      summary.focus({preventScroll: true});
    }
  });
  document.addEventListener('pointerdown', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  window.addEventListener('focus', load);
  window.addEventListener('online', load);
  window.addEventListener('hashchange', () => { menu.open = false; });
  setInterval(load, 15000);

  return {showFor};
}
