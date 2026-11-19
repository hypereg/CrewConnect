import {
  ACCESS_POINTS, CATEGORIES, DECKS, DEFAULT_PLACES, isAccessPoint,
  metersBetween, nearestAccess, planRoute, withClimbingWall
} from './ship-data.mjs?v=2';
import {SCENE_WIDTH, SCENE_HEIGHT, deckElevation, drawDeck, drawRouteArrows, projectPoint, unprojectPoint} from './ship-canvas.mjs?v=7';

const el = id => document.getElementById(id);
const canvas = el('deck-map');
const motion = el('route-motion');
const stage = el('map-stage');
const mapSpace = el('map-space');
const viewport = el('map-viewport');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const apiBase = document.querySelector('meta[name="crewconnect-api"]').content;
const api = apiBase ? new URL('/api/places', apiBase) : new URL('api/places', location.href);
const params = new URLSearchParams(location.search);
const choosingPlace = params.get('pick') === '1';
const requestedPlace = params.get('place');
const storageKey = 'crewconnect-wonder-map-v2';
const legacyStorageKey = 'crewconnect-wonder-map-v1';
const esc = text => String(text).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const searchText = text => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');
const pinStyle = category => `--pin-color:${category.color};--pin-bg:${category.pale}`;
let catalog = {places: choosingPlace ? [] : DEFAULT_PLACES, storage: 'loading'};
let originId = 'guest-services';
let destinationId = requestedPlace ?? (choosingPlace ? null : 'casino-royale');
let customOrigin;
let deck = 5;
let transport = 'lift';
let panel = 'guest';
let picking = null;
let zoom = 1;
let cameraFrame;
let arrowFrame;
let flowStep;
let sceneVisible = true;
let drawnDeck;
let route = null;
let steps = [];
let stepIndex = 0;
let editingId;
let draft;
let busy = false;

const placeById = id => catalog.places.find(place => place.id === id);
const origin = () => originId === 'custom' ? customOrigin : placeById(originId);
const destination = () => placeById(destinationId);
const deckOption = ({id}) => `<option value="${id}">${id}</option>`;
const placeOption = place => `<option value="${esc(place.id)}">${esc(place.name)} · pokład ${place.deck}</option>`;
const positionStyle = point => {
  const {x, y} = projectPoint(point, deckElevation(point.deck));
  return `left:${x / SCENE_WIDTH * 100}%;top:${y / SCENE_HEIGHT * 100}%`;
};
const report = message => { el('map-status').textContent = message; };

function directionsFor(result, target) {
  const groups = [];
  for (const leg of result.legs) {
    let direction;
    if (leg.type === 'walk') {
      direction = leg.from.x === leg.to.x ? (leg.from.y < leg.to.y ? 'lewej burty' : 'prawej burty') :
        leg.from.x < leg.to.x ? 'rufy' : 'dziobu';
    }
    const last = groups.at(-1);
    const merge = last?.type === leg.type && (leg.type === 'walk' ? last.direction === direction : last.end === leg.end);
    if (merge) {
      last.to = leg.to;
    } else {
      groups.push({...leg, direction});
    }
  }
  const instructions = groups.map(({type, from, to, direction, end}) => {
    const goingUp = to.deck > from.deck;
    let instruction = `Idź w stronę ${direction} · ok. ${Math.max(1, Math.round(metersBetween(from, to)))} m`;
    if (type === 'lift') {
      instruction = `${goingUp ? 'Wjedź' : 'Zjedź'} windą ${end === 'dziobowe' ? 'dziobową' : 'rufową'} na pokład ${to.deck}`;
    }
    if (type === 'stairs') {
      instruction = `${goingUp ? 'Wejdź' : 'Zejdź'} schodami ${end === 'dziobowe' ? 'dziobowymi' : 'rufowymi'} na pokład ${to.deck}`;
    }
    return {type, instruction, point: from, endPoint: to, goingUp};
  });
  instructions.push({type: 'arrival', instruction: `Cel · ${target.name}`, point: target});
  return instructions;
}

function directionIcon(step) {
  if (step.type === 'arrival') return '⚑';
  if (step.type !== 'walk') return step.goingUp ? '↑' : '↓';
  const from = projectPoint(step.point);
  const to = projectPoint(step.endPoint);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  return ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][(Math.round(angle / (Math.PI / 4)) + 8) % 8];
}

function updateArrowMotion() {
  cancelAnimationFrame(arrowFrame);
  drawRouteArrows(motion, flowStep);
  if (!sceneVisible || reducedMotion.matches || !flowStep || flowStep.type === 'arrival') return;
  const began = performance.now();
  let lastDraw = began;
  function frame(now) {
    if (now - lastDraw >= 31) {
      drawRouteArrows(motion, flowStep, now - began);
      lastDraw = now;
    }
    arrowFrame = requestAnimationFrame(frame);
  }
  arrowFrame = requestAnimationFrame(frame);
}

function calculateRoute() {
  const target = destination();
  route = planRoute(origin(), target, transport);
  steps = route ? directionsFor(route, target) : [];
  stepIndex = 0;
}

function renderGuestPlaces() {
  const list = el('guest-places');
  const scroll = list.scrollTop;
  const query = searchText(el('place-search').value.trim());
  const matches = catalog.places.filter(({name, category, keywords, description}) =>
    searchText(`${name} ${CATEGORIES[category].label} ${keywords ?? ''} ${description}`).includes(query));
  list.innerHTML = matches.map(place => {
    const category = CATEGORIES[place.category];
    return `<li><button type="button" class="place-option" data-place="${esc(place.id)}" aria-pressed="${place.id === destinationId}">
      <span class="place-icon" aria-hidden="true" style="${pinStyle(category)}">${category.mark}</span>
      <span><strong>${esc(place.name)}</strong><small>Pokład ${place.deck} · ${category.label}</small></span>
    </button></li>`;
  }).join('') || '<li class="empty-list">' + (catalog.storage === 'loading' ? 'Wczytywanie miejsc…' :
    catalog.storage === 'unavailable' ? 'Katalog miejsc jest chwilowo niedostępny.' : 'Brak pasujących miejsc.') + '</li>';
  list.scrollTop = scroll;
}

function renderSelects() {
  const places = catalog.places.map(placeOption).join('');
  el('origin').innerHTML = places + ACCESS_POINTS.map((point, index) => {
    const {label} = point;
    return `<option value="access-${index}">${label} · bieżący pokład</option>`;
  }).join('') + (customOrigin ? `<option value="custom">Punkt na mapie · pokład ${customOrigin.deck}</option>` : '');
  el('origin').value = originId ?? '';
  el('catalog').innerHTML = '<option value="">+ Nowe miejsce</option>' + places;
  el('catalog').value = editingId ?? '';
}

function renderDeck() {
  if (drawnDeck !== undefined && drawnDeck !== deck) {
    stage.classList.remove('deck-change');
    void stage.offsetWidth;
    stage.classList.add('deck-change');
  }
  drawnDeck = deck;
  el('deck-subtitle').textContent = `Pokład ${deck}`;
  el('deck-title').textContent = DECKS.find(item => item.id === deck).name;
  for (const button of el('deck-tabs').children) button.setAttribute('aria-pressed', String(Number(button.dataset.deck) === deck));
  el('pick-origin').setAttribute('aria-pressed', String(picking === 'origin'));
  el('pick-place').setAttribute('aria-pressed', String(picking === 'place'));
  viewport.classList.toggle('picking', Boolean(picking));
  el('pick-banner').hidden = !picking;
  el('pick-banner').textContent = picking === 'origin' ? 'Kliknij korytarz lub miejsce, od którego ruszasz.' :
    'Kliknij wejście do miejsca. Pinezka wskoczy na najbliższy korytarz.';
  const navigating = panel === 'guest' && !choosingPlace;
  const from = navigating ? origin() : null;
  const step = navigating && !picking && steps[stepIndex]?.point.deck === deck ? steps[stepIndex] : null;
  const current = step?.point;
  const pin = from?.deck === deck ? `<span class="map-pin start-pin" style="${positionStyle(from)}" aria-hidden="true">●</span>` : '';
  const waypoint = current && step.type !== 'arrival' ?
    `<span class="current-waypoint" style="${positionStyle(current)}" aria-hidden="true"></span>` : '';
  const markers = catalog.places.filter(place => place.deck === deck).map(place => {
    const category = CATEGORIES[place.category];
    const target = (navigating || choosingPlace) && place.id === destinationId;
    const selected = panel === 'admin' && place.id === editingId;
    return `<button type="button" class="map-pin${target ? ' selected' : ''}${selected ? ' active-place' : ''}${place.x > 800 ? ' near-stern' : ''}"
      data-place="${esc(place.id)}" aria-label="${esc(place.name)}" ${choosingPlace ? `aria-pressed="${target}"` : ''}
      style="${pinStyle(category)};${positionStyle(place)}">
      <span aria-hidden="true">${category.mark}</span><span class="pin-label" aria-hidden="true">${esc(place.name)}</span>
    </button>`;
  }).join('');
  el('map-pins').innerHTML = markers + pin + waypoint;
  drawDeck(canvas, deck, navigating && !picking ? route?.legs ?? [] : [], step, panel === 'admin' ? draft : null);
  flowStep = step;
  updateArrowMotion();
}

function renderRoute() {
  const card = el('route-card');
  card.hidden = panel !== 'guest';
  el('map-guidance').hidden = panel !== 'guest' || !route || Boolean(picking);
  if (panel !== 'guest') return;
  const target = destination();
  if (!route) {
    card.innerHTML = '<h2 id="route-title">Trasa</h2><p class="route-empty">' +
      (requestedPlace && !target && catalog.storage !== 'loading' ? 'Wybranego miejsca nie ma w aktualnym katalogu. Wskaż inny cel.' :
        'Wybierz punkt startowy i miejsce docelowe.') + '</p>';
    return;
  }
  el('map-step-count').textContent = `Krok ${stepIndex + 1} z ${steps.length} · pokład ${steps[stepIndex].point.deck}`;
  el('map-maneuver').textContent = directionIcon(steps[stepIndex]);
  el('map-instruction').textContent = steps[stepIndex].instruction;
  el('previous-step').disabled = stepIndex === 0;
  el('next-step').disabled = stepIndex === steps.length - 1;
  card.innerHTML = `<div class="route-head">
    <div><h2 id="route-title">${esc(target.name)}</h2>
    <p>Pokład ${target.deck}${target.description ? ' · ' + esc(target.description) : ''}</p></div>
    <span class="route-metrics">${route.minutes ? `ok. ${route.minutes} min · ${route.meters} m` : 'Jesteś przy celu'}</span>
  </div>
  <ol class="route-steps">${steps.map(({instruction, point}, index) =>
    `<li><button type="button" class="route-step" data-step="${index}" ${index === stepIndex ? 'aria-current="step"' : ''}>
      <span>${index + 1}</span> Pokład ${point.deck} · ${esc(instruction)}
    </button></li>`).join('')}</ol>`;
}

function cameraCenter() {
  return {
    x: (viewport.scrollLeft + viewport.clientWidth / 2 - stage.offsetLeft) / stage.offsetWidth * SCENE_WIDTH,
    y: (viewport.scrollTop + viewport.clientHeight / 2 - stage.offsetTop) / stage.offsetHeight * SCENE_HEIGHT
  };
}

function fittedWidth() {
  return Math.min(viewport.clientWidth, viewport.clientHeight * SCENE_WIDTH / SCENE_HEIGHT);
}

function paintCamera(scale, point) {
  zoom = scale;
  mapSpace.style.setProperty('--map-width', Math.round(fittedWidth() * zoom) + 'px');
  viewport.scrollLeft = stage.offsetLeft + point.x / SCENE_WIDTH * stage.offsetWidth - viewport.clientWidth / 2;
  viewport.scrollTop = stage.offsetTop + point.y / SCENE_HEIGHT * stage.offsetHeight - viewport.clientHeight / 2;
  viewport.classList.toggle('zoomed', zoom > 1.01);
  el('map-pan-hint').hidden = zoom <= 1.01;
  el('zoom-out').disabled = zoom <= 1.001;
  el('zoom-in').disabled = zoom >= 2.4;
}

function moveCamera(scale, point = cameraCenter(), animate = true) {
  cancelAnimationFrame(cameraFrame);
  const targetZoom = Math.max(1, Math.min(2.4, scale));
  const target = targetZoom === 1 ? {x: SCENE_WIDTH / 2, y: SCENE_HEIGHT / 2} : point;
  if (!animate || reducedMotion.matches) {
    paintCamera(targetZoom, target);
    return;
  }
  const initialZoom = zoom;
  const initial = cameraCenter();
  const began = performance.now();
  const interpolate = (a, b, amount) => a + (b - a) * amount;
  function frame(now) {
    const elapsed = Math.min(1, (now - began) / 450);
    const ease = 1 - (1 - elapsed) ** 3;
    paintCamera(interpolate(initialZoom, targetZoom, ease), {
      x: interpolate(initial.x, target.x, ease),
      y: interpolate(initial.y, target.y, ease)
    });
    if (elapsed < 1) cameraFrame = requestAnimationFrame(frame);
  }
  cameraFrame = requestAnimationFrame(frame);
}

function framePoints(points) {
  if (!points.length) {
    moveCamera(1);
    return;
  }
  const projected = points.map(point => projectPoint(point, deckElevation(point.deck)));
  const xs = projected.map(point => point.x);
  const ys = projected.map(point => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const fitted = fittedWidth();
  const horizontal = viewport.clientWidth / fitted * SCENE_WIDTH / (maxX - minX + 290);
  const vertical = viewport.clientHeight / fitted * SCENE_WIDTH / (maxY - minY + 180);
  moveCamera(Math.min(2.15, horizontal, vertical), {x: (minX + maxX) / 2, y: (minY + maxY) / 2});
}

function focusStep(step) {
  if (!step) {
    moveCamera(1);
    return;
  }
  framePoints([step.point, step.endPoint ?? step.point]);
}

function revealMapOnMobile() {
  if (matchMedia('(max-width: 760px)').matches) {
    viewport.closest('.deck-card').scrollIntoView({block: 'start', behavior: reducedMotion.matches ? 'instant' : 'smooth'});
  }
}

function showStep(index, fromList = false) {
  const step = steps[index];
  if (!step) return;
  stepIndex = index;
  deck = step.point.deck;
  renderDeck();
  renderRoute();
  focusStep(step);
  revealMapOnMobile();
  if (fromList) el('route-card').querySelector(`.route-step[data-step="${index}"]`)?.focus({preventScroll: true});
  report(`Pokład ${deck}. ${step.instruction}`);
}

function setRoute({announce = false} = {}) {
  calculateRoute();
  deck = origin()?.deck ?? deck;
  renderGuestPlaces();
  renderDeck();
  renderRoute();
  if (announce && route) {
    focusStep(steps[0]);
    report(`Trasa do ${destination().name}. ${steps[0].instruction}`);
  } else {
    moveCamera(1, undefined, false);
  }
}

function setDestination(id, fromMap = false) {
  const place = placeById(id);
  if (!place) return;
  destinationId = id;
  if (choosingPlace) {
    if (deck !== place.deck) switchDeck(place.deck);
    else renderDeck();
    renderMeetingPlace();
    const focus = fromMap ? el('map-pins') : el('guest-places');
    focus.querySelector(`[data-place="${CSS.escape(id)}"]`)?.focus({preventScroll: true});
    return;
  }
  setRoute({announce: true});
  const focus = fromMap ? viewport : el('guest-places').querySelector(`[data-place="${CSS.escape(id)}"]`);
  focus?.focus({preventScroll: true});
  revealMapOnMobile();
}

function renderMeetingPlace() {
  const place = destination();
  renderGuestPlaces();
  el('meeting-place').textContent = place ? `${place.name} · pokład ${place.deck}` : 'Wskaż pinezkę lub miejsce z listy.';
  el('confirm-place').disabled = !place;
}

function setOrigin(point, id = 'custom') {
  if (id === 'custom') customOrigin = {...point, deck: point.deck ?? deck, name: 'Punkt na mapie'};
  originId = id;
  picking = null;
  renderSelects();
  setRoute({announce: true});
}

function adminStatus(message, error = false) {
  const status = el('admin-status');
  status.textContent = message;
  status.dataset.error = error;
}

const databaseEdits = () => catalog.storage === 'database' && catalog.editable;

function renderStorage() {
  el('admin-auth').hidden = !databaseEdits();
  el('storage-note').textContent = databaseEdits() ? 'MongoDB · zmiany widoczne dla gości.' :
    catalog.storage === 'loading' ? 'Wczytywanie katalogu…' : 'Tryb demo · zmiany w tej przeglądarce.';
  el('save-place').disabled = busy || catalog.storage === 'loading';
  el('delete-place').disabled = busy || catalog.storage === 'loading';
}

function renderDraft() {
  const options = el('place-entry');
  options.innerHTML = '<option value="">Wybierz wejście</option>' +
    ACCESS_POINTS.map(({label}, index) => `<option value="${index}">${label}</option>`).join('') +
    (draft ? '<option value="placed">Wejście zaznaczone na mapie</option>' : '');
  const reference = draft && ACCESS_POINTS.findIndex(point => point.x === draft.x && point.y === draft.y);
  options.value = !draft ? '' : reference >= 0 ? String(reference) : 'placed';
  renderDeck();
}

function editPlace(id) {
  if (busy) return;
  const place = placeById(id);
  editingId = place?.id;
  picking = null;
  if (place) deck = place.deck;
  draft = place ? {deck, x: place.x, y: place.y} : null;
  el('catalog').value = editingId ?? '';
  el('place-name').value = place?.name ?? '';
  el('place-category').value = place?.category ?? 'fun';
  el('place-deck').value = String(deck);
  el('place-description').value = place?.description ?? '';
  el('delete-place').hidden = !place;
  adminStatus('');
  renderDraft();
  if (draft) framePoints([draft]);
  else moveCamera(1);
}

function applyCatalog(next) {
  catalog = next;
  if (choosingPlace) {
    const place = placeById(requestedPlace);
    if (place) {
      destinationId = place.id;
      deck = place.deck;
    }
    renderMeetingPlace();
    renderDeck();
    return;
  }
  if (!origin()) originId = placeById('guest-services')?.id ?? catalog.places[0]?.id;
  const requested = placeById(requestedPlace);
  if (!requestedPlace && !destination()) destinationId = placeById('casino-royale')?.id ?? catalog.places.find(place => place.id !== originId)?.id;
  renderSelects();
  renderStorage();
  if (panel === 'guest') {
    setRoute();
    if (requested) switchDeck(requested.deck);
  }
  else renderDeck();
}

const validPlaces = places => Array.isArray(places) && places.every(place =>
  isAccessPoint(place) && typeof place.id === 'string' && typeof place.name === 'string' &&
  typeof place.description === 'string' && Object.hasOwn(CATEGORIES, place.category));

async function loadCatalog() {
  let next = choosingPlace ? {places: [], storage: 'unavailable'} : {places: DEFAULT_PLACES, storage: 'demo'};
  try {
    const response = await fetch(api, {cache: 'no-store', signal: AbortSignal.timeout(4500)});
    if (response.ok) {
      const data = await response.json();
      if (validPlaces(data.places)) next = data;
    }
  } catch {
    // Keep a usable catalog with a local editor if the server is unavailable.
  }
  if (!choosingPlace && !requestedPlace && !next.editable) {
    try {
      const local = JSON.parse(localStorage.getItem(storageKey));
      if (validPlaces(local)) next = {...next, places: local, storage: 'demo'};
      else if (local === null) {
        const previous = JSON.parse(localStorage.getItem(legacyStorageKey));
        if (validPlaces(previous)) next = {...next, places: withClimbingWall(previous), storage: 'demo'};
      }
    } catch {
      // A damaged browser cache can be replaced by the sample catalog.
    }
  }
  applyCatalog(next);
}

async function savePlace(action) {
  if (busy || catalog.storage === 'loading') return;
  const id = editingId;
  const place = {
    ...draft, name: el('place-name').value.trim(), category: el('place-category').value,
    description: el('place-description').value.trim()
  };
  if (action === 'save' && (!place.name || !isAccessPoint(place))) {
    adminStatus('Wpisz nazwę i wskaż wejście przy korytarzu.', true);
    return;
  }
  if (action === 'delete' && (!id || !window.confirm(`Usunąć ${placeById(id).name} z katalogu?`))) return;
  busy = true;
  renderStorage();
  let message;
  try {
    if (databaseEdits()) {
      const credentials = new TextEncoder().encode('map-admin:' + el('map-password').value);
      const response = await fetch(api, {
        method: 'POST', signal: AbortSignal.timeout(7000),
        headers: {'Content-Type': 'application/json', Authorization: 'Basic ' + btoa(String.fromCharCode(...credentials))},
        body: JSON.stringify({action, id, place, revision: catalog.revision})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Nie udało się zapisać miejsca.');
      applyCatalog(result);
    } else {
      let places = catalog.places;
      if (action === 'delete') places = places.filter(item => item.id !== id);
      else if (id) places = places.map(item => item.id === id ? {...item, ...place} : item);
      else {
        if (places.length >= 100) throw new Error('Katalog mieści do 100 miejsc.');
        places = [...places, {...place, id: crypto.randomUUID()}];
      }
      localStorage.setItem(storageKey, JSON.stringify(places));
      applyCatalog({...catalog, storage: 'demo', places});
    }
    message = action === 'delete' ? 'Usunięto miejsce.' : 'Zapisano miejsce.';
  } catch (error) {
    adminStatus(error.name === 'Error' ? error.message : 'Nie udało się połączyć z bazą. Spróbuj ponownie.', true);
  } finally {
    busy = false;
    renderStorage();
  }
  if (message && panel === 'admin') {
    editPlace(action === 'delete' ? undefined : id ?? catalog.places.at(-1)?.id);
    adminStatus(message);
  }
}

function setMode(mode) {
  if (busy) return;
  panel = mode;
  picking = null;
  el('guest-panel').hidden = mode !== 'guest';
  el('admin-panel').hidden = mode !== 'admin';
  el('guest-mode').setAttribute('aria-pressed', String(mode === 'guest'));
  el('admin-mode').setAttribute('aria-pressed', String(mode === 'admin'));
  if (mode === 'admin') editPlace(editingId);
  else setRoute();
  renderRoute();
}

function setPicking(mode) {
  picking = picking === mode ? null : mode;
  if (picking === 'place') deck = Number(el('place-deck').value);
  renderDeck();
  renderRoute();
  if (picking) {
    viewport.focus({preventScroll: true});
    revealMapOnMobile();
  }
}

function setDraft(point) {
  if (busy) return;
  const fromMap = picking === 'place';
  draft = {deck, x: point.x, y: point.y};
  picking = null;
  el('place-deck').value = String(deck);
  renderDraft();
  if (fromMap) el('place-entry').focus();
  report(`Zaznaczono wejście na pokładzie ${deck}.`);
}

el('guest-mode').addEventListener('click', () => setMode('guest'));
el('admin-mode').addEventListener('click', () => setMode('admin'));
el('place-search').addEventListener('input', renderGuestPlaces);
el('guest-places').addEventListener('click', event => {
  const id = event.target.closest('[data-place]')?.dataset.place;
  if (id) setDestination(id);
});
el('origin').addEventListener('change', event => {
  const id = event.target.value;
  if (id.startsWith('access-')) {
    setOrigin(ACCESS_POINTS[Number(id.slice(7))]);
  } else {
    setOrigin(id === 'custom' ? customOrigin : placeById(id), id);
  }
});
for (const input of document.querySelectorAll('[name="transport"]')) {
  input.addEventListener('change', () => {
    transport = input.value;
    setRoute({announce: true});
  });
}
el('deck-tabs').innerHTML = DECKS.map(({id}) =>
  `<button type="button" data-deck="${id}" aria-label="Pokład ${id}">${id}</button>`).join('');
function switchDeck(selected) {
  if (!DECKS.some(item => item.id === selected)) return;
  deck = selected;
  if (picking === 'place') {
    el('place-deck').value = String(deck);
    draft = null;
    renderDraft();
  } else {
    renderDeck();
  }
  const points = !picking && panel === 'guest' ? (route?.legs ?? []).flatMap(leg =>
    [leg.from, leg.to].filter(point => point.deck === deck)) : [];
  framePoints(points);
}
el('deck-tabs').addEventListener('click', event => {
  switchDeck(Number(event.target.closest('[data-deck]')?.dataset.deck));
});
el('map-pins').addEventListener('click', event => {
  const place = placeById(event.target.closest('[data-place]')?.dataset.place);
  if (!place) return;
  if (picking === 'place') setDraft(place);
  else if (picking === 'origin') setOrigin(place, place.id);
  else if (panel === 'admin') editPlace(place.id);
  else setDestination(place.id, true);
});
el('route-card').addEventListener('click', event => {
  const index = event.target.closest('[data-step]')?.dataset.step;
  if (index !== undefined) showStep(Number(index), true);
});
el('previous-step').addEventListener('click', () => showStep(stepIndex - 1));
el('next-step').addEventListener('click', () => showStep(stepIndex + 1));
el('pick-origin').addEventListener('click', () => setPicking('origin'));
el('pick-place').addEventListener('click', () => setPicking('place'));
el('catalog').addEventListener('change', event => editPlace(event.target.value));
el('place-deck').addEventListener('change', event => {
  deck = Number(event.target.value);
  if (draft) draft = {...draft, deck};
  renderDraft();
});
el('place-entry').addEventListener('change', event => {
  const value = event.target.value;
  if (value === 'placed') return;
  if (!value) {
    draft = null;
    renderDraft();
  } else {
    deck = Number(el('place-deck').value);
    setDraft(ACCESS_POINTS[Number(value)]);
  }
});
el('place-form').addEventListener('submit', event => {
  event.preventDefault();
  void savePlace('save');
});
el('delete-place').addEventListener('click', () => { void savePlace('delete'); });
el('zoom-out').addEventListener('click', () => moveCamera(zoom - 0.35));
el('zoom-in').addEventListener('click', () => moveCamera(zoom + 0.35));
el('zoom-fit').addEventListener('click', () => moveCamera(1));
new ResizeObserver(() => moveCamera(zoom, cameraCenter(), false)).observe(viewport);
new IntersectionObserver(([entry]) => {
  if (sceneVisible === entry.isIntersecting) return;
  sceneVisible = entry.isIntersecting;
  updateArrowMotion();
}).observe(viewport);
reducedMotion.addEventListener('change', updateArrowMotion);
viewport.addEventListener('wheel', event => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  moveCamera(zoom - Math.sign(event.deltaY) * 0.2, cameraCenter(), false);
}, {passive: false});

let drag;
let moved = false;
canvas.addEventListener('pointerdown', event => {
  cancelAnimationFrame(cameraFrame);
  moved = false;
  if (event.pointerType === 'mouse' && event.button === 0 && zoom > 1) {
    drag = {x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop};
    canvas.setPointerCapture(event.pointerId);
  }
});
canvas.addEventListener('pointermove', event => {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (Math.hypot(dx, dy) > 4) moved = true;
  if (moved) {
    viewport.scrollLeft = drag.left - dx;
    viewport.scrollTop = drag.top - dy;
    viewport.classList.add('dragging');
  }
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(type, () => {
    drag = null;
    viewport.classList.remove('dragging');
  });
}
canvas.addEventListener('click', event => {
  if (!picking || moved) return;
  const bounds = canvas.getBoundingClientRect();
  const {x, y} = unprojectPoint({
    x: (event.clientX - bounds.left) / bounds.width * SCENE_WIDTH,
    y: (event.clientY - bounds.top) / bounds.height * SCENE_HEIGHT
  }, deckElevation(deck));
  if (x < 85 || x > 900 || y < 58 || y > 296) {
    el('pick-banner').textContent = 'Wskaż miejsce wewnątrz planu statku.';
    report('Wskaż miejsce wewnątrz planu statku.');
    return;
  }
  const point = nearestAccess({x, y});
  if (picking === 'origin') setOrigin(point);
  else setDraft(point);
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && choosingPlace) {
    window.parent.postMessage({type: 'crewconnect-place-cancel'}, location.origin);
  }
  if (event.key === 'Escape' && picking) {
    picking = null;
    renderDeck();
    renderRoute();
  }
});

el('place-category').innerHTML = Object.entries(CATEGORIES).map(([value, category]) =>
  `<option value="${value}">${category.label}</option>`).join('');
el('place-deck').innerHTML = DECKS.map(deckOption).join('');
renderSelects();
renderStorage();
if (choosingPlace) {
  el('planner-title').textContent = 'Miejsca na statku';
  el('guest-panel').querySelector('label[for=place-search]').textContent = 'Szukaj miejsca';
  el('place-confirm').hidden = false;
  el('confirm-place').addEventListener('click', () => {
    const place = destination();
    if (place) window.parent.postMessage({type: 'crewconnect-place-selected', place}, location.origin);
  });
  renderMeetingPlace();
  renderDeck();
} else setRoute();
void loadCatalog();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
