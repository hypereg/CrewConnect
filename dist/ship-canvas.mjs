import {CORES, CORRIDORS, DECKS} from './ship-data.mjs?v=2';

export const SCENE_WIDTH = 1000;
export const SCENE_HEIGHT = 575;
const DECK_RISE = 42;
const HULL_DEPTH = 24;
const origin = {x: 104, y: 159};
const along = {x: 0.94, y: 0.17};
const across = {x: -0.31, y: 0.60};
const determinant = along.x * across.y - along.y * across.x;
const hullOutline = 'M 35 177 C 44 112 100 66 179 57 L 822 57 Q 917 57 927 135 L 927 219 Q 917 297 822 297 L 179 297 C 100 288 44 242 35 177 Z';
let hull;

export function projectPoint({x, y}, elevation = 0) {
  return {
    x: origin.x + along.x * x + across.x * y,
    y: origin.y + along.y * x + across.y * y - elevation
  };
}

export function unprojectPoint({x, y}, elevation = 0) {
  const dx = x - origin.x;
  const dy = y + elevation - origin.y;
  return {
    x: (across.y * dx - across.x * dy) / determinant,
    y: (along.x * dy - along.y * dx) / determinant
  };
}

export function deckElevation(deck) {
  return (deck - DECKS[0].id) * DECK_RISE;
}
const plans = {
  4: [
    [95, 86, 187, 48, 'Royal Theater', 'fun'],
    [116, 222, 163, 50, 'The Attic', 'fun'],
    [342, 72, 80, 62, 'Art Gallery', 'other'],
    [442, 72, 118, 62, 'Studio B', 'fun'],
    [567, 72, 136, 62, 'Center Ice Rink', 'fun'],
    [331, 220, 116, 60, 'Crown Lounge', 'other'],
    [458, 220, 242, 60, 'Casino Royale', 'fun'],
    [739, 76, 118, 58, 'Izumi', 'food'],
    [740, 222, 141, 56, 'Dining Room', 'food']
  ],
  5: [
    [110, 80, 174, 54, 'Royal Theater', 'fun'],
    [119, 220, 167, 55, 'Spa', 'other'],
    [335, 75, 98, 59, 'Promenade Shops', 'shop'],
    [443, 75, 106, 59, 'Sorrento’s', 'food'],
    [558, 75, 130, 59, 'Café Promenade', 'food'],
    [338, 220, 99, 60, 'Boleros', 'food'],
    [445, 220, 106, 60, 'NextCruise', 'service'],
    [559, 220, 132, 60, 'Guest Services', 'service'],
    [732, 75, 128, 59, 'Galeria', 'other'],
    [734, 220, 152, 60, 'Main Dining Room', 'food']
  ],
  6: [
    [111, 78, 172, 56, 'Fitness Center', 'other'],
    [116, 220, 171, 57, 'Vitality Café', 'food'],
    [335, 76, 96, 58, 'Kabiny', 'other'],
    [442, 76, 120, 58, 'Focus Gallery', 'service'],
    [574, 76, 124, 58, 'Schooner Bar', 'food'],
    [335, 220, 96, 60, 'Kabiny', 'other'],
    [442, 220, 118, 60, 'Picture This', 'service'],
    [572, 220, 128, 60, 'Boardwalk Dog House', 'food'],
    [733, 76, 108, 58, 'Carousel', 'fun'],
    [732, 220, 129, 60, 'Sugar Beach', 'shop'],
    [873, 128, 48, 94, 'Aqua', 'fun']
  ],
  7: [
    [112, 80, 172, 54, 'Kabiny dziobowe', 'other'],
    [112, 220, 174, 55, 'Kabiny dziobowe', 'other'],
    [338, 76, 160, 58, 'Kabiny', 'other'],
    [508, 76, 188, 58, 'Kabiny', 'other'],
    [338, 220, 160, 59, 'Kabiny', 'other'],
    [508, 220, 191, 59, 'Kabiny', 'other'],
    [750, 84, 137, 50, 'Ścianka wspinaczkowa', 'fun'],
    [743, 220, 145, 58, 'Ścianka wspinaczkowa', 'fun']
  ]
};
const hues = {
  fun: ['#f1eafa', '#554374', '#c6b4d9', '#ddd0ed'],
  food: ['#fcf0df', '#6d472c', '#d7bca0', '#efdbc3'],
  service: ['#e4f1f7', '#2f596c', '#a1c4d2', '#c1dce7'],
  shop: ['#f8eaf1', '#73475c', '#d0a9bf', '#e9cedd'],
  other: ['#edf2ef', '#405f57', '#b4c9c2', '#d4e2db']
};

function box(ctx, x, y, w, h, fill, border, radius = 5) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function line(ctx, from, to, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function text(ctx, value, x, y, color, font = '650 13px system-ui', width = SCENE_WIDTH) {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y, width);
}

function contextFor(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(canvas.width / SCENE_WIDTH, 0, 0, canvas.height / SCENE_HEIGHT, 0, 0);
  return ctx;
}

function planSpace(ctx, depth, draw) {
  ctx.save();
  ctx.transform(along.x, along.y, across.x, across.y, origin.x, origin.y + depth);
  draw();
  ctx.restore();
}

function face(ctx, [first, ...rest], fill) {
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const point of rest) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function building(ctx, [x, y, width, height, name, category], elevation, wallHeight) {
  const [roof, ink, wall, trim] = hues[category];
  const front = {x, y: y + height};
  const corner = {x: x + width, y: y + height};
  const side = {x: x + width, y};
  const base = point => projectPoint(point, elevation);
  const raised = point => projectPoint(point, elevation + wallHeight);
  face(ctx, [raised(side), raised(corner), base(corner), base(side)], trim);
  face(ctx, [raised(front), raised(corner), base(corner), base(front)], wall);
  planSpace(ctx, -elevation - wallHeight, () => box(ctx, x, y, width, height, roof, trim, 2));
  const label = raised({x: x + width / 2, y: y + height / 2});
  text(ctx, name, label.x, label.y, ink, width > 110 ? '730 15px system-ui' : '700 12px system-ui', width * 0.88);
}

function drawHull(ctx, elevation) {
  hull ??= new Path2D(hullOutline);
  ctx.save();
  ctx.shadowColor = '#1e566060';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 9;
  ctx.fillStyle = '#6c939e';
  planSpace(ctx, HULL_DEPTH, () => ctx.fill(hull));
  ctx.restore();

  // Each sweep fills the side; the selected deck is the only exposed surface.
  for (let depth = HULL_DEPTH; depth > -elevation; depth--) {
    if (depth >= 14) ctx.fillStyle = '#1e5061';
    else if (depth > 0) ctx.fillStyle = '#3c7686';
    else {
      const seam = -depth % DECK_RISE;
      ctx.fillStyle = seam < 3 ? '#527f8a' : seam < 10 ? '#a1bfc7' : '#bfd4d9';
    }
    planSpace(ctx, depth, () => ctx.fill(hull));
  }
  ctx.fillStyle = '#f8fbfa';
  planSpace(ctx, -elevation, () => ctx.fill(hull));

  ctx.fillStyle = '#486e7b';
  for (let level = 0; level < elevation; level += DECK_RISE) {
    for (let x = 217; x < 805; x += 25) {
      const point = projectPoint({x, y: 297}, level + 14);
      ctx.beginPath();
      ctx.ellipse(point.x, point.y, 4.2, 2.6, 0.17, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = '#7ca6ac';
  ctx.lineWidth = 2;
  planSpace(ctx, -elevation, () => ctx.stroke(hull));
}

function chevron(ctx, point, angle, size) {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(angle);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-size / 2, -size / 2);
  ctx.lineTo(size / 2, 0);
  ctx.lineTo(-size / 2, size / 2);
  ctx.stroke();
  ctx.restore();
}

export function drawRouteArrows(canvas, step, elapsed) {
  const ctx = contextFor(canvas);
  ctx.clearRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
  if (!step || step.type === 'arrival') return;
  const from = projectPoint(step.point, deckElevation(step.point.deck));
  const to = projectPoint(step.endPoint, deckElevation(step.endPoint.deck));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const angle = Math.atan2(dy, dx);
  const draw = distance => chevron(ctx, {
    x: from.x + dx * distance / length, y: from.y + dy * distance / length
  }, angle, Math.min(8, length / 2));
  if (elapsed === undefined || length < 12) {
    for (const part of length < 65 ? [0.5] : [0.27, 0.53, 0.78]) draw(length * part);
    return;
  }
  if (length < 38) {
    const phase = elapsed % 750 / 750;
    ctx.globalAlpha = 0.4 + 0.6 * Math.sin(phase * Math.PI);
    draw(length * (0.28 + phase * 0.44));
    ctx.globalAlpha = 1;
    return;
  }
  const spacing = Math.min(34, (length - 10) / 2);
  const shift = elapsed * 0.045 % spacing;
  for (let distance = 5 + shift; distance < length - 5; distance += spacing) {
    ctx.globalAlpha = Math.min(1, (distance - 5) / 8, (length - 5 - distance) / 8);
    draw(distance);
  }
  ctx.globalAlpha = 1;
}

function drawCorridors(ctx, elevation) {
  ctx.lineCap = 'round';
  for (const [from, to] of CORRIDORS) line(ctx, projectPoint(from, elevation), projectPoint(to, elevation), '#dceae9', 18);
  for (const [from, to] of CORRIDORS) line(ctx, projectPoint(from, elevation), projectPoint(to, elevation), '#fff', 13);
}

function drawRoute(ctx, deck, elevation, legs, step) {
  const onDeck = point => projectPoint(point, elevation);
  const walking = legs.filter(leg => leg.type === 'walk' && leg.from.deck === deck)
    .map(({from, to}) => [onDeck(from), onDeck(to)]);
  for (const [from, to] of walking) line(ctx, from, to, '#fff', 16);
  for (const [from, to] of walking) line(ctx, from, to, '#43877c', 9);
  for (const [from, to] of walking) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.hypot(dx, dy) < 30) continue;
    chevron(ctx, {x: (from.x + to.x) / 2, y: (from.y + to.y) / 2}, Math.atan2(dy, dx), 6);
  }
  if (step?.type === 'walk') {
    const from = onDeck(step.point);
    const to = onDeck(step.endPoint);
    line(ctx, from, to, '#fff', 19);
    line(ctx, from, to, '#075f50', 13);
  }
  if (step?.type === 'lift' || step?.type === 'stairs') {
    const from = onDeck(step.point);
    const to = projectPoint(step.endPoint, deckElevation(step.endPoint.deck));
    line(ctx, from, to, '#fff', 16);
    line(ctx, from, to, '#075f50', 11);
    ctx.beginPath();
    ctx.arc(to.x, to.y, 7, 0, 2 * Math.PI);
    ctx.fillStyle = '#075f50';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    box(ctx, to.x + 14, to.y - 12, 76, 24, '#164654', '#fff', 6);
    text(ctx, `Pokład ${step.endPoint.deck}`, to.x + 52, to.y, '#fff', '750 12px system-ui');
  }
  const shown = new Set();
  for (const leg of legs.filter(leg => leg.type !== 'walk')) {
    const point = leg.from.deck === deck ? leg.from : leg.to.deck === deck ? leg.to : null;
    if (!point || shown.has(point.x)) continue;
    shown.add(point.x);
    const position = onDeck(point);
    const selected = step?.type === leg.type && step.point.x === point.x;
    if (selected) {
      ctx.beginPath();
      ctx.arc(position.x, position.y, 18, 0, 2 * Math.PI);
      ctx.fillStyle = '#a6d5cc';
      ctx.fill();
    }
    box(ctx, position.x - 10, position.y - 10, 20, 20, '#075b50', '#fff', 10);
    text(ctx, leg.to.deck > leg.from.deck ? '↑' : '↓', position.x, position.y, '#fff', '800 14px system-ui');
    const badgeX = position.x + (selected ? 46 : 0);
    const badgeY = position.y - (selected ? 14 : 25.5);
    box(ctx, badgeX - 30, badgeY - 11.5, 60, 23, '#163f49', '#fff', 6);
    text(ctx, leg.type === 'lift' ? 'Winda' : 'Schody', badgeX, badgeY, '#fff', '750 12px system-ui');
  }
}

function drawActive(ctx, deck, elevation) {
  planSpace(ctx, -elevation, () => {
    box(ctx, 124, 153, 738, 49, '#edf4f1', '#e0ebe7');
  });
  const center = projectPoint({x: 536, y: 177}, elevation);
  text(ctx, DECKS.find(item => item.id === deck).name, center.x, center.y, '#557b72', '730 13px system-ui');
  drawCorridors(ctx, elevation);
  for (const room of [...plans[deck]].sort((a, b) => projectPoint({x: a[0], y: a[1]}).y -
    projectPoint({x: b[0], y: b[1]}).y)) {
    building(ctx, room, elevation, room[5] === 'other' ? 11 : 17);
  }
  for (const {x} of CORES) building(ctx, [x - 19, 158, 38, 39, '≋  ↕', 'service'], elevation, 8);
}

export function drawDeck(canvas, deck, legs, step, draft) {
  const ctx = contextFor(canvas);
  const water = ctx.createLinearGradient(0, 0, 0, SCENE_HEIGHT);
  water.addColorStop(0, '#dfeff0');
  water.addColorStop(1, '#c5dfe3');
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
  for (let y = 17; y < SCENE_HEIGHT; y += 25) {
    line(ctx, {x: 0, y}, {x: SCENE_WIDTH, y}, '#a9c8cf45', 1);
  }
  const elevation = deckElevation(deck);
  drawHull(ctx, elevation);
  drawActive(ctx, deck, elevation);
  drawRoute(ctx, deck, elevation, legs, step);
  if (draft?.deck === deck) {
    const point = projectPoint(draft, elevation);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 9, 0, 2 * Math.PI);
    ctx.fillStyle = '#ecbe55';
    ctx.fill();
    ctx.strokeStyle = '#4f3e15';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  text(ctx, 'D Z I Ó B', 46, 256 - elevation, '#376271', '750 11px system-ui');
  text(ctx, 'R U F A', 954, 408 - elevation, '#376271', '750 11px system-ui');
}
