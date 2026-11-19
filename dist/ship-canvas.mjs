import {CORES, CORRIDORS, DECKS} from './ship-data.mjs?v=2';

export const SCENE_WIDTH = 1000;
export const SCENE_HEIGHT = 575;
export const DECK_GAP = 108;
const origin = {x: 104, y: 108};
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

export function unprojectPoint({x, y}) {
  const dx = x - origin.x;
  const dy = y - origin.y;
  return {
    x: (across.y * dx - across.x * dy) / determinant,
    y: (along.x * dy - along.y * dx) / determinant
  };
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

function building(ctx, [x, y, width, height, name, category], elevation) {
  const [roof, ink, wall, trim] = hues[category];
  const front = {x, y: y + height};
  const corner = {x: x + width, y: y + height};
  const side = {x: x + width, y};
  const raised = point => projectPoint(point, elevation);
  face(ctx, [raised(side), raised(corner), projectPoint(corner), projectPoint(side)], trim);
  face(ctx, [raised(front), raised(corner), projectPoint(corner), projectPoint(front)], wall);
  planSpace(ctx, -elevation, () => box(ctx, x, y, width, height, roof, trim, 2));
  const label = raised({x: x + width / 2, y: y + height / 2});
  text(ctx, name, label.x, label.y, ink, width > 110 ? '730 15px system-ui' : '700 12px system-ui', width * 0.88);
}

function drawNeighbor(ctx, neighbor) {
  const {deck, elevation} = neighbor;
  hull ??= new Path2D(hullOutline);
  ctx.fillStyle = '#9fbdc7';
  planSpace(ctx, 12 - elevation, () => ctx.fill(hull));
  planSpace(ctx, -elevation, () => {
    ctx.fillStyle = '#eff6f7';
    ctx.fill(hull);
    ctx.strokeStyle = '#7198a6';
    ctx.lineWidth = 2;
    ctx.stroke(hull);
    for (const [x, y, w, h] of plans[deck]) box(ctx, x, y, w, h, '#d8e7ec', '#b8cfd8', 3);
  });
  for (const {x} of CORES) {
    const core = projectPoint({x, y: 176}, elevation);
    box(ctx, core.x - 11, core.y - 8, 22, 16, '#6f9aa9', '#f3f8fa', 4);
    text(ctx, '↕', core.x, core.y, '#fff', '750 11px system-ui');
  }
}

function drawHull(ctx) {
  hull ??= new Path2D(hullOutline);
  ctx.save();
  ctx.shadowColor = '#1e56607a';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#779caa';
  planSpace(ctx, 37, () => ctx.fill(hull));
  ctx.restore();
  for (let depth = 34; depth >= 0; depth -= 1) {
    ctx.fillStyle = depth === 0 ? '#f8fbfa' : depth > 26 ? '#345e6a' : depth > 20 ? '#638895' : '#c1d5d6';
    planSpace(ctx, depth, () => ctx.fill(hull));
  }
  ctx.fillStyle = '#547481';
  for (let x = 202; x < 805; x += 24) {
    const point = projectPoint({x, y: 297}, -12);
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, 4.2, 2.3, 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#a5c2c4';
  ctx.lineWidth = 2;
  planSpace(ctx, 0, () => ctx.stroke(hull));
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
  const from = projectPoint(step.point);
  const to = step.type === 'walk' ? projectPoint(step.endPoint) :
    projectPoint(step.point, step.goingUp ? DECK_GAP : -DECK_GAP);
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

function drawCorridors(ctx) {
  ctx.lineCap = 'round';
  for (const [from, to] of CORRIDORS) line(ctx, projectPoint(from), projectPoint(to), '#dceae9', 18);
  for (const [from, to] of CORRIDORS) line(ctx, projectPoint(from), projectPoint(to), '#fff', 13);
}

function drawRoute(ctx, deck, legs, step) {
  const walking = legs.filter(leg => leg.type === 'walk' && leg.from.deck === deck)
    .map(({from, to}) => [projectPoint(from), projectPoint(to)]);
  for (const [from, to] of walking) line(ctx, from, to, '#fff', 16);
  for (const [from, to] of walking) line(ctx, from, to, '#43877c', 9);
  for (const [from, to] of walking) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.hypot(dx, dy) < 30) continue;
    chevron(ctx, {x: (from.x + to.x) / 2, y: (from.y + to.y) / 2}, Math.atan2(dy, dx), 6);
  }
  if (step?.type === 'walk') {
    const from = projectPoint(step.point);
    const to = projectPoint(step.endPoint);
    line(ctx, from, to, '#fff', 19);
    line(ctx, from, to, '#075f50', 13);
  }
  if (step?.type === 'lift' || step?.type === 'stairs') {
    const from = projectPoint(step.point);
    const to = projectPoint(step.point, step.goingUp ? DECK_GAP : -DECK_GAP);
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
    const position = projectPoint(point);
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

export function drawDeck(canvas, deck, neighbor, legs, step, draft) {
  const ctx = contextFor(canvas);
  const water = ctx.createLinearGradient(0, 0, 0, SCENE_HEIGHT);
  water.addColorStop(0, '#dfeff0');
  water.addColorStop(1, '#c5dfe3');
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
  for (let y = 17; y < SCENE_HEIGHT; y += 25) {
    line(ctx, {x: 0, y}, {x: SCENE_WIDTH, y}, '#a9c8cf45', 1);
  }
  if (neighbor) drawNeighbor(ctx, neighbor);
  drawHull(ctx);
  planSpace(ctx, 0, () => {
    box(ctx, 124, 153, 738, 49, '#edf4f1', '#e0ebe7');
  });
  const center = projectPoint({x: 536, y: 177});
  text(ctx, DECKS.find(item => item.id === deck).name, center.x, center.y, '#557b72', '730 13px system-ui');
  drawCorridors(ctx);
  for (const room of [...plans[deck]].sort((a, b) => projectPoint({x: a[0], y: a[1]}).y -
    projectPoint({x: b[0], y: b[1]}).y)) {
    building(ctx, room, room[5] === 'other' ? 11 : 17);
  }
  for (const {x} of CORES) building(ctx, [x - 19, 158, 38, 39, '≋  ↕', 'service'], 8);
  drawRoute(ctx, deck, legs, step);
  if (draft?.deck === deck) {
    const point = projectPoint(draft);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 9, 0, 2 * Math.PI);
    ctx.fillStyle = '#ecbe55';
    ctx.fill();
    ctx.strokeStyle = '#4f3e15';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  text(ctx, 'D Z I Ó B', 45, 216, '#376271', '750 11px system-ui');
  text(ctx, 'R U F A', 954, 404, '#376271', '750 11px system-ui');
}
