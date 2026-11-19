(() => {
  const themeKey = 'crewconnect-color-theme';
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  const themeButtons = [...document.querySelectorAll('[data-theme-toggle]')];
  function savedTheme() {
    try { return localStorage.getItem(themeKey); } catch { return null; }
  }
  function applyTheme(theme = savedTheme()) {
    const dark = theme ? theme === 'dark' : systemTheme.matches;
    root.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a202d' : '#f4f7f4');
    const label = dark ? 'Włącz tryb jasny' : 'Włącz tryb ciemny';
    for (const button of themeButtons) {
      button.setAttribute('aria-label', label);
      button.title = label;
      button.querySelector('use').setAttribute('href', 'assets/interface.svg#' + (dark ? 'sun' : 'moon'));
    }
  }
  for (const button of themeButtons) {
    button.addEventListener('click', () => {
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(themeKey, theme); } catch { /* The current view can still change theme. */ }
      applyTheme(theme);
    });
  }
  window.addEventListener('storage', event => {
    if (event.key === themeKey || event.key === null) applyTheme();
  });
  systemTheme.addEventListener('change', () => applyTheme());
  applyTheme();

  const drawer = document.querySelector('[data-drawer]');
  if (drawer) {
    const mobile = matchMedia('(max-width: 860px)');
    const toggle = document.querySelector('[data-drawer-toggle]');
    const close = drawer.querySelector('[data-drawer-close]');
    const background = [...document.querySelectorAll('[data-drawer-background]')];
    const skip = document.querySelector('.skip-link');
    let isOpen = false;
    const setOpen = (open, restoreFocus = false) => {
      isOpen = open && mobile.matches;
      document.body.classList.toggle('drawer-open', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
      drawer.inert = mobile.matches && !isOpen;
      for (const element of background) element.inert = isOpen;
      if (skip) skip.inert = isOpen;
      if (isOpen) {
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
        close.focus({preventScroll: true});
      } else {
        drawer.removeAttribute('role');
        drawer.removeAttribute('aria-modal');
        if (restoreFocus && toggle.getClientRects().length) toggle.focus({preventScroll: true});
      }
    };
    setOpen(false);
    toggle.addEventListener('click', () => setOpen(true));
    close.addEventListener('click', () => setOpen(false, true));
    document.querySelector('[data-drawer-shade]').addEventListener('click', () => setOpen(false, true));
    drawer.addEventListener('click', event => {
      const link = event.target.closest('a');
      if (isOpen && link && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) setOpen(false, true);
    });
    mobile.addEventListener('change', () => setOpen(false));
    window.addEventListener('hashchange', () => { if (isOpen) setOpen(false, true); });
    document.addEventListener('keydown', event => {
      if (!isOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false, true);
      } else if (event.key === 'Tab') {
        const focusable = [...drawer.querySelectorAll('a[href], button:not([disabled])')].filter(element => element.getClientRects().length);
        const first = focusable[0];
        const last = focusable.at(-1);
        if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    });
  }

  const content = document.querySelector('[data-shell] #content');
  const searchText = text => text.trim().toLocaleLowerCase('pl').normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');
  content?.addEventListener('input', event => {
    const listId = event.target.dataset.filterList;
    if (!listId) return;
    const query = searchText(event.target.value);
    let matching = 0;
    for (const row of document.getElementById(listId).children) {
      const value = row.dataset.searchText ?? row.querySelector('[data-search-text]')?.dataset.searchText ?? row.textContent;
      row.hidden = !searchText(value).includes(query);
      if (!row.hidden) matching++;
    }
    content.querySelector('[data-filter-empty="' + listId + '"]').hidden = matching > 0;
  });
  content?.addEventListener('click', event => {
    if (reducedMotion.matches || !event.target.closest('.calendar')) return;
    const action = event.target.closest('button[data-action]')?.dataset.action;
    const context = action === 'day' ? '.agenda' : action === 'month' || action === 'today' ? '.calendar-grid' : '';
    if (context) requestAnimationFrame(() => {
      content.querySelector(context)?.animate([{opacity: .55}, {opacity: 1}], {duration: 210, easing: 'ease-out'});
    });
  });
  if (content && !content.closest('.app-shell')) {
    document.querySelector('.skip-link')?.addEventListener('click', event => {
      event.preventDefault();
      content.focus();
    });
  }
  if (content) window.addEventListener('hashchange', () => {
    if (reducedMotion.matches || document.body.classList.contains('is-landing')) return;
    requestAnimationFrame(() => {
      content.querySelector('h1')?.animate([{opacity: .35, translate: '0 5px'}, {opacity: 1, translate: '0 0'}],
        {duration: 240, easing: 'ease-out'});
    });
  });

  let motionLibrary;
  let revealObserver;
  document.addEventListener('crewconnect:landing', async () => {
    if (reducedMotion.matches) return;
    motionLibrary ??= new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'assets/motion-14.14.0.js';
      script.onload = () => resolve(window.Motion);
      script.onerror = () => resolve(null);
      document.head.append(script);
    });
    const motion = await motionLibrary;
    const hero = document.querySelector('.landing-hero');
    if (!motion || !hero || reducedMotion.matches || window.scrollY > 40) return;
    const {animate, stagger} = motion;
    animate([
      [hero.querySelector('.landing-hero-photo img'), {scale: [1.07, 1]}, {duration: 1.2, ease: 'easeOut'}],
      [hero.querySelectorAll('[data-hero-copy]'), {y: [16, 0], opacity: [.15, 1]}, {at: 0, delay: stagger(.075), duration: .52, ease: 'easeOut'}],
      [hero.querySelector('figcaption'), {y: [8, 0], opacity: [.1, 1]}, {at: .19, duration: .55, ease: 'easeOut'}]
    ]);
    revealObserver?.disconnect();
    revealObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        revealObserver.unobserve(entry.target);
        if (reducedMotion.matches) continue;
        animate(entry.target.querySelectorAll('[data-reveal]'), {y: [14, 0], opacity: [.5, 1]},
          {delay: stagger(.075), duration: .44, ease: 'easeOut'});
      }
    }, {threshold: .2});
    document.querySelectorAll('.fleet-grid, .guide-grid').forEach(group => revealObserver.observe(group));
  });
})();
