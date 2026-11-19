import {CORES, CORRIDORS, WIDTH, HEIGHT} from './ship-data.mjs';

const hull = new Path2D('M 35 177 C 44 112 100 66 179 57 L 822 57 Q 917 57 927 135 L 927 219 Q 917 297 822 297 L 179 297 C 100 288 44 242 35 177 Z');
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
  ]
};
const hues = {
  fun: ['#eee9f8', '#6a5386'],
  food: ['#f7ecdf', '#815533'],
  service: ['#e1eff3', '#3a697c'],
  shop: ['#f5e7f0', '#87536c'],
  other: ['#e8eeeb', '#55716a']
};

function box(ctx, x, y, w, h, fill, border) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 5);
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

function text(ctx, value, x, y, color, font = '650 12px system-ui') {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

function routeArrows(ctx, {from, to}) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance < 40) return;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.save();
  ctx.translate((from.x + to.x) / 2, (from.y + to.y) / 2);
  ctx.rotate(angle);
  line(ctx, {x: -3, y: -2.5}, {x: 0, y: 0}, '#fff', 1.8);
  line(ctx, {x: 0, y: 0}, {x: -3, y: 2.5}, '#fff', 1.8);
  ctx.restore();
}

export function drawDeck(canvas, deck, legs, draft) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
  ctx.fillStyle = '#deecea';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (let y = 13; y < HEIGHT; y += 20) {
    line(ctx, {x: 0, y}, {x: WIDTH, y}, '#d2e4e0', 1);
  }
  text(ctx, 'D Z I Ó B', 85, 33, '#496f68', '700 11px system-ui');
  text(ctx, 'R U F A', 881, 33, '#496f68', '700 11px system-ui');
  ctx.fillStyle = '#f9fbfa';
  ctx.save();
  ctx.shadowColor = '#1d514643';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.fill(hull);
  ctx.restore();

  ctx.save();
  ctx.clip(hull);
  ctx.fillStyle = '#f4f8f6';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  box(ctx, 117, 151, 751, 52, '#edf3ed', '#e1ebe6');
  text(ctx, deck === 4 ? 'Entertainment Place' : deck === 5 ? 'Royal Promenade' : 'Boardwalk',
    526, 177, '#7a9990', '700 13px system-ui');
  for (const [x, y, w, h, label, category] of plans[deck]) {
    const [fill, color] = hues[category];
    box(ctx, x, y, w, h, fill, '#d9e3e0');
    text(ctx, label, x + w / 2, y + h / 2, color, w < 110 ? '650 10px system-ui' : '650 12px system-ui');
  }
  ctx.lineCap = 'round';
  for (const [from, to] of CORRIDORS) line(ctx, from, to, '#dee9e4', 18);
  for (const [from, to] of CORRIDORS) line(ctx, from, to, '#fff', 14);
  for (const {x} of CORES) {
    box(ctx, x - 19, 157, 38, 40, '#e1eeea', '#a9c6bc');
    text(ctx, '≋', x - 9, 171, '#386660', '700 15px system-ui');
    text(ctx, '↕', x + 8, 171, '#386660', '700 13px system-ui');
    text(ctx, 'PION', x, 188, '#386660', '750 8px system-ui');
  }
  const walking = legs.filter(leg => leg.type === 'walk' && leg.from.deck === deck);
  for (const {from, to} of walking) line(ctx, from, to, '#fff', 13);
  for (const {from, to} of walking) line(ctx, from, to, '#12816b', 8);
  for (const leg of walking) routeArrows(ctx, leg);
  for (const leg of legs.filter(leg => leg.type !== 'walk')) {
    const point = leg.from.deck === deck ? leg.from : leg.to.deck === deck ? leg.to : null;
    if (!point) continue;
    box(ctx, point.x - 12, point.y - 12, 24, 24, '#075b50', '#fff');
    text(ctx, leg.type === 'lift' ? '↕' : '≋', point.x, point.y, '#fff', '750 15px system-ui');
  }
  if (draft?.deck === deck) {
    ctx.beginPath();
    ctx.arc(draft.x, draft.y, 9, 0, 2 * Math.PI);
    ctx.fillStyle = '#ecbe55';
    ctx.fill();
    ctx.strokeStyle = '#4f3e15';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#8eb1a8';
  ctx.lineWidth = 2;
  ctx.stroke(hull);
  text(ctx, 'PRAWA BURTA', 480, 36, '#496f68', '700 10px system-ui');
  text(ctx, 'LEWA BURTA', 480, 319, '#496f68', '700 10px system-ui');
}
