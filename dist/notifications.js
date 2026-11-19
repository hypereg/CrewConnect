let notificationBoard;
let notificationError = '';
let notificationLoading = false;
let pendingNotificationChat;
const notificationTime = new Intl.DateTimeFormat('pl-PL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

async function requestNotifications(payload) {
  const response = await fetch('api/notifications', payload ? {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
  } : {cache:'no-store'});
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error),{status:response.status});
  return result;
}

const notificationMenu = document.querySelector('.notification-menu');

function renderNotifications() {
  notificationMenu.hidden = !state.userProfile;
  if (!state.userProfile) notificationMenu.open = false;
  const items = notificationBoard?.items ?? [];
  const unread = items.filter(item => item.unread).length;
  const badge = notificationMenu.querySelector('[data-unread]');
  badge.hidden = unread === 0;
  badge.textContent = String(unread);
  notificationMenu.querySelector('summary').setAttribute('aria-label',
    unread ? `Powiadomienia, nieprzeczytane: ${unread}` : 'Powiadomienia');
  const list = notificationMenu.querySelector('.notification-list');
  const html = notificationError ? `<p class="muted">${escape(notificationError)}</p>` : !notificationBoard ?
    '<p class="muted">Wczytywanie powiadomień…</p>' : items.length ? items.map(item =>
      `<button type="button" class="notification-item${item.unread ? ' unread' : ''}" data-notification-id="${escape(item.id)}">
        <span class="notification-symbol" aria-hidden="true">${item.kind === 'message' ? '✉' : '▦'}</span>
        <span><strong>${item.kind === 'message' ? 'Wiadomość od ' : 'Nowa aktywność: '}${escape(item.title)}</strong>
        <time datetime="${escape(item.at)}">${notificationTime.format(new Date(item.at))}</time></span>
        ${item.unread ? '<span class="notification-dot" aria-label="Nieprzeczytane"></span>' : ''}
      </button>`).join('') : '<p class="muted">Brak powiadomień.</p>';
  if (list.dataset.markup !== html) {
    const active = list.contains(document.activeElement) ? document.activeElement.dataset.notificationId : '';
    list.innerHTML = html;
    list.dataset.markup = html;
    if (active) [...list.querySelectorAll('[data-notification-id]')].find(item =>
      item.dataset.notificationId === active)?.focus({preventScroll:true});
  }
  notificationMenu.querySelector('[data-notification-action="readAll"]').disabled = unread === 0;
  notificationMenu.querySelector('[data-notification-action="clear"]').disabled = !items.length;
}

async function loadNotifications() {
  if (!state.userProfile || notificationLoading || document.hidden) return;
  notificationLoading = true;
  const profile = state.userProfile.id;
  try {
    if (syncing) await syncing;
    const board = await requestNotifications();
    if (state.userProfile?.id !== profile) return;
    notificationBoard = board;
    notificationError = '';
  } catch (error) {
    if (state.userProfile?.id === profile) notificationError = error.message || 'Nie udało się pobrać powiadomień.';
  } finally {
    notificationLoading = false;
    renderNotifications();
  }
}

function startNotificationChat() {
  if (!pendingNotificationChat || !onlineDiscovery || location.hash !== '#zaloga') return;
  const peer = pendingNotificationChat;
  pendingNotificationChat = undefined;
  if (onlineDiscovery.matches.includes(peer)) openCrewChat(peer);
  else announce('Ta rozmowa jest już niedostępna.');
}

notificationMenu.addEventListener('toggle', () => {
  if (notificationMenu.open) void loadNotifications();
});
notificationMenu.addEventListener('click', async event => {
  const control = event.target.closest('button');
  const board = notificationBoard;
  if (!control || !board) return;
  const action = control.dataset.notificationAction;
  const item = board.items.find(entry => entry.id === control.dataset.notificationId);
  if (item) {
    notificationMenu.open = false;
    if (item.kind === 'message') {
      pendingNotificationChat = item.target;
      location.hash = '#zaloga';
      if (onlineDiscovery?.matches.includes(item.target)) startNotificationChat();
      else void refreshDiscovery();
    } else {
      location.hash = '#aktywnosci';
      void refreshEvents().then(() => {
        const eventCard = [...content.querySelectorAll('[data-event-card]')].find(card => card.dataset.eventCard === item.target);
        eventCard?.scrollIntoView({block:'center'});
        eventCard?.focus({preventScroll:true});
      });
    }
  }
  if (!action && !item?.unread) return;
  try {
    await requestNotifications(action ? {action,through:board.through} : {action:'read',id:item.id});
    await loadNotifications();
  } catch (error) {
    announce(error.message);
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && notificationMenu.open) {
    notificationMenu.open = false;
    notificationMenu.querySelector('summary').focus();
  }
});
document.addEventListener('pointerdown', event => {
  if (notificationMenu.open && !notificationMenu.contains(event.target)) notificationMenu.open = false;
});
window.addEventListener('focus', loadNotifications);
window.addEventListener('online', loadNotifications);
setInterval(loadNotifications, 12000);
