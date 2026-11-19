export const WIDTH = 960;
export const HEIGHT = 354;
export const DECKS = [
  {id: 4, name: 'Entertainment Place'},
  {id: 5, name: 'Royal Promenade'},
  {id: 6, name: 'Boardwalk'}
];

export const CATEGORIES = {
  fun: {label: 'Rozrywka', mark: '✦', color: '#6054aa', pale: '#efebfa'},
  food: {label: 'Jedzenie i napoje', mark: '◉', color: '#aa5929', pale: '#fff1dc'},
  service: {label: 'Obsługa gości', mark: 'i', color: '#287496', pale: '#e4f3fa'},
  shop: {label: 'Zakupy', mark: '◇', color: '#a13764', pale: '#fae9f2'},
  other: {label: 'Inne', mark: '•', color: '#50736d', pale: '#e7f0ec'}
};

export const DEFAULT_PLACES = [
  {id: 'royal-theater', name: 'Royal Theater', category: 'fun', deck: 4, x: 191, y: 144, description: 'Główna sala teatralna w dziobowej części statku.', keywords: 'teatr show'},
  {id: 'studio-b', name: 'Studio B', category: 'fun', deck: 4, x: 446, y: 144, description: 'Scena z lodowiskiem w strefie Entertainment Place.', keywords: 'lodowisko lód'},
  {id: 'casino-royale', name: 'Casino Royale', category: 'fun', deck: 4, x: 603, y: 210, description: 'Kasyno w środkowej części pokładu 4.', keywords: 'kasyno'},
  {id: 'guest-services', name: 'Guest Services', category: 'service', deck: 5, x: 621, y: 210, description: 'Recepcja i punkt obsługi gości przy Royal Promenade.', keywords: 'recepcja informacja pomoc'},
  {id: 'sorrentos', name: 'Sorrento’s', category: 'food', deck: 5, x: 461, y: 144, description: 'Pizzeria przy Royal Promenade.', keywords: 'pizza pizzeria'},
  {id: 'cafe-promenade', name: 'Café Promenade', category: 'food', deck: 5, x: 581, y: 144, description: 'Kawa i przekąski przy promenadzie.', keywords: 'kawiarnia kawa'},
  {id: 'main-dining', name: 'Main Dining Room', category: 'food', deck: 5, x: 802, y: 210, description: 'Wejście do głównej restauracji od strony rufy.', keywords: 'restauracja jadalnia'},
  {id: 'carousel', name: 'Boardwalk Carousel', category: 'fun', deck: 6, x: 748, y: 144, description: 'Karuzela w otwartej strefie Boardwalk.', keywords: 'karuzela'},
  {id: 'sugar-beach', name: 'Sugar Beach', category: 'shop', deck: 6, x: 775, y: 210, description: 'Sklep ze słodyczami przy Boardwalk.', keywords: 'sklep słodycze lody'},
  {id: 'aquatheater', name: 'AquaTheater', category: 'fun', deck: 6, x: 864, y: 177, description: 'Teatr wodny na rufie.', keywords: 'teatr wodny spektakl'}
];

const HALL_X = [122, 230, 310, 432, 550, 650, 720, 805, 864];
const HALL_Y = [144, 210];
const CROSSINGS = [122, 310, 432, 650, 720, 864];
export const CORES = [
  {x: 310, end: 'dziobowe'},
  {x: 720, end: 'rufowe'}
];
export const CORRIDORS = [
  ...HALL_Y.flatMap(y => HALL_X.slice(1).map((x, i) => [{x: HALL_X[i], y}, {x, y}])),
  ...CROSSINGS.map(x => [{x, y: HALL_Y[0]}, {x, y: HALL_Y[1]}])
];

export const ACCESS_POINTS = [
  {x: 122, y: 144, label: 'Korytarz przy dziobie'},
  {x: 310, y: 144, label: 'Schody dziobowe'},
  {x: 310, y: 210, label: 'Winda dziobowa'},
  {x: 550, y: 144, label: 'Korytarz na śródokręciu · prawa burta'},
  {x: 550, y: 210, label: 'Korytarz na śródokręciu · lewa burta'},
  {x: 720, y: 144, label: 'Schody rufowe'},
  {x: 720, y: 210, label: 'Winda rufowa'},
  {x: 864, y: 210, label: 'Korytarz przy rufie'}
];

export function nearestAccess(point) {
  let best;
  for (const [a, b] of CORRIDORS) {
    const axis = a.x === b.x ? 'y' : 'x';
    const candidate = {...a, [axis]: Math.round(Math.max(a[axis], Math.min(b[axis], point[axis])))};
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (!best || distance < best.distance) best = {point: candidate, distance};
  }
  return best.point;
}

export function isAccessPoint(place) {
  if (!DECKS.some(deck => deck.id === place?.deck) || !Number.isInteger(place.x) || !Number.isInteger(place.y)) return false;
  const snapped = nearestAccess(place);
  return snapped.x === place.x && snapped.y === place.y;
}

export const metersBetween = (a, b) => Math.hypot((a.x - b.x) * 0.38, (a.y - b.y) * 0.23);
const key = ({deck, x, y}) => `${deck}:${x}:${y}`;

export function planRoute(start, destination, transport) {
  if (!isAccessPoint(start) || !isAccessPoint(destination) || !['lift', 'stairs'].includes(transport)) return null;
  const points = new Map();
  const graph = new Map();
  function connect(a, b, type, seconds, end) {
    const from = key(a);
    const to = key(b);
    if (from === to) return;
    points.set(from, a);
    points.set(to, b);
    if (!graph.has(from)) graph.set(from, []);
    if (!graph.has(to)) graph.set(to, []);
    graph.get(from).push({to, type, seconds, end});
    graph.get(to).push({to: from, type, seconds, end});
  }
  for (const {id: deck} of DECKS) {
    for (const [a, b] of CORRIDORS) {
      const axis = a.x === b.x ? 'y' : 'x';
      const fixed = axis === 'x' ? 'y' : 'x';
      const waypoints = [start, destination].filter(point => point.deck === deck &&
        point[fixed] === a[fixed] && point[axis] > a[axis] && point[axis] < b[axis]);
      const segment = [{...a, deck}, ...waypoints.sort((p, q) => p[axis] - q[axis]), {...b, deck}];
      for (let i = 1; i < segment.length; i++) {
        const [from, to] = [segment[i - 1], segment[i]];
        connect(from, to, 'walk', metersBetween(from, to) / 1.25);
      }
    }
  }
  const y = transport === 'lift' ? HALL_Y[1] : HALL_Y[0];
  for (const {x, end} of CORES) {
    for (const [index, deck] of DECKS.slice(1).entries()) {
      connect({deck: DECKS[index].id, x, y}, {deck: deck.id, x, y}, transport, transport === 'lift' ? 25 : 17, end);
    }
  }
  const first = key(start);
  const last = key(destination);
  const cost = new Map([[first, 0]]);
  const previous = new Map();
  const open = new Set(points.keys());
  while (open.size) {
    let current;
    let best = Infinity;
    for (const id of open) {
      const score = cost.get(id);
      if (score !== undefined && score < best) {
        current = id;
        best = score;
      }
    }
    if (current === undefined || current === last) break;
    open.delete(current);
    for (const edge of graph.get(current)) {
      const next = best + edge.seconds;
      if (next >= (cost.get(edge.to) ?? Infinity)) continue;
      cost.set(edge.to, next);
      previous.set(edge.to, {...edge, from: current});
    }
  }
  if (!cost.has(last)) return null;
  const legs = [];
  for (let id = last; id !== first;) {
    const {from, type, end} = previous.get(id);
    legs.unshift({from: points.get(from), to: points.get(id), type, end});
    id = from;
  }
  return {
    legs,
    meters: Math.round(legs.reduce((total, leg) => total + (leg.type === 'walk' ? metersBetween(leg.from, leg.to) : 0), 0)),
    minutes: Math.ceil(cost.get(last) / 60)
  };
}
