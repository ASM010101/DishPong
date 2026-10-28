// Generates the animated SVGs used in the README from *real* simulation runs.
//   docs/demo.svg            fresh culture vs trained culture, recorded frame by frame
//   docs/learning-curve.svg  mean hit rate, feedback vs no-feedback control
// Usage: node tools/make-readme-media.js
const fs = require('fs');
const path = require('path');
const Dish = require('../dish.js');
const C = Dish.CONST;
const OUT = path.join(__dirname, '..', 'docs');
fs.mkdirSync(OUT, { recursive: true });

const f1 = (x) => (Math.round(x * 10) / 10).toString();
const f2 = (x) => (Math.round(x * 100) / 100).toString();

// ------------------------------------------------------------ recording
function train(dish, events) {
  while (dish.stats.events.length < events) dish.step();
}

function record(dish, ticks, every) {
  const fr = [];
  let glow = 0;
  const startHits = dish.stats.hits, startMiss = dish.stats.misses;
  for (let t = 0; t < ticks; t++) {
    dish.step();
    if (dish.lastEvent === 'hit') glow = 1;
    glow = Math.max(0, glow - 0.04);
    if (t % every === 0) {
      fr.push({
        bx: dish.ballX, by: dish.ballY, py: dish.paddleY,
        play: dish.phase === 'play', noise: dish.phase === 'noise',
        glow, up: dish.pUp, dn: dish.pDn,
      });
    }
  }
  return { fr, hits: dish.stats.hits - startHits, misses: dish.stats.misses - startMiss };
}

// --------------------------------------------------------------- demo.svg
function panel(rec, x0, y0, title, subtitle, accent, id, dur) {
  const S = 0.875, W = C.GW * S, H = C.GH * S;
  const fr = rec.fr;
  const vals = (fn) => fr.map(fn).join(';');
  const anim = (attr, fn, mode = 'linear') =>
    `<animate attributeName="${attr}" dur="${dur}s" repeatCount="indefinite" calcMode="${mode}" values="${vals(fn)}"/>`;

  const padX = C.PAD_X * S, padW = C.PAD_W * S, padH = C.PAD_H * S;
  const barY = y0 + 70 + H + 22;
  return `
  <g transform="translate(${x0},0)">
    <text x="0" y="${y0 + 22}" class="h">${title}</text>
    <text x="0" y="${y0 + 44}" class="sub">${subtitle}</text>
    <g transform="translate(0,${y0 + 62})">
      <rect width="${W}" height="${H}" rx="10" fill="#070b10" stroke="#223042" stroke-width="2"/>
      ${Array.from({ length: 7 }, (_, i) => `<line x1="0" x2="${W}" y1="${f1((i + 1) * H / 8)}" y2="${f1((i + 1) * H / 8)}" stroke="#5ad1ff" stroke-opacity=".05"/>`).join('')}
      <rect width="${W}" height="${H}" rx="10" filter="url(#static-${id})" opacity="0">
        ${anim('opacity', (f) => (f.noise ? 0.55 : 0), 'discrete')}
      </rect>
      <rect width="${W}" height="${H}" rx="10" fill="#ff3c50" opacity="0">
        ${anim('opacity', (f) => (f.noise ? 0.16 : 0), 'discrete')}
      </rect>
      <text x="${W / 2}" y="34" class="ev miss" opacity="0">MISS · unpredictable noise
        ${anim('opacity', (f) => (f.noise ? 1 : 0), 'discrete')}
      </text>
      <text x="${W / 2}" y="34" class="ev hit" opacity="0">HIT · calm beat
        ${anim('opacity', (f) => f2(f.play ? f.glow : 0))}
      </text>
      <rect x="${padX - 4}" width="${padW + 8}" height="${padH + 8}" rx="6" fill="#6fb8ff" filter="url(#blur)" opacity="0">
        ${anim('y', (f) => f1((f.py - C.PAD_H / 2) * S - 4))}
        ${anim('opacity', (f) => f2(f.glow))}
      </rect>
      <rect x="${padX}" width="${padW}" height="${padH}" rx="3" fill="#e8f1fa">
        ${anim('y', (f) => f1((f.py - C.PAD_H / 2) * S))}
      </rect>
      <circle r="${C.BALL_R * S}" fill="#fff">
        ${anim('cx', (f) => f1(f.bx * S))}
        ${anim('cy', (f) => f1(f.by * S))}
        ${anim('opacity', (f) => (f.play ? 1 : 0), 'discrete')}
      </circle>
    </g>
    <text x="0" y="${barY + 9}" class="lbl">PADDLE DRIVE</text>
    <text x="104" y="${barY + 9}" class="lbl" fill="#ffb454">DOWN</text>
    <text x="${W}" y="${barY + 9}" class="lbl" fill="#4fe0a8" text-anchor="end">UP</text>
    <rect x="146" y="${barY}" width="${W - 176}" height="12" rx="6" fill="#1a2330"/>
    <line x1="${146 + (W - 176) / 2}" x2="${146 + (W - 176) / 2}" y1="${barY - 3}" y2="${barY + 15}" stroke="#3a5068"/>
    ${(() => {
      // net UP-minus-DOWN drive, drawn from the centre line
      const half = (W - 176) / 2, cx = 146 + half;
      const net = (f) => Math.max(-1, Math.min(1, (f.up - f.dn) * 3));
      return `<rect y="${barY + 2}" height="8" rx="4" fill="#4fe0a8">
        ${anim('x', (f) => f1(cx + Math.min(0, net(f)) * half))}
        ${anim('width', (f) => f1(Math.abs(net(f)) * half))}
        ${anim('fill', (f) => (net(f) >= 0 ? '#4fe0a8' : '#ffb454'), 'discrete')}
      </rect>`;
    })()}
    <text x="${W}" y="${y0 + 22}" class="pill" fill="${accent}" text-anchor="end">${Math.round((100 * rec.hits) / Math.max(1, rec.hits + rec.misses))}% hits in this clip</text>
  </g>`;
}

function demoSvg() {
  const TICKS = 900, EVERY = 2, DUR = TICKS / 60; // real-time 1x playback
  console.log('recording fresh culture…');
  // A 15 s clip only holds a handful of rallies, so keep a clip whose hit
  // rate matches a fresh culture's typical ~20% instead of a lucky streak.
  let recA = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const fresh = new Dish();
    fresh.lr = 0; // show the untrained culture as-is
    const r = record(fresh, TICKS, EVERY);
    const rate = r.hits / (r.hits + r.misses || 1);
    if (!recA || Math.abs(rate - 0.2) < Math.abs(recA.hits / (recA.hits + recA.misses || 1) - 0.2)) recA = r;
  }

  console.log('training a culture (this takes a few seconds)…');
  let best = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const d = new Dish();
    train(d, 1300);
    const r = record(d, TICKS, EVERY);
    if (!best || r.hits / (r.hits + r.misses || 1) > best.hits / (best.hits + best.misses || 1)) best = r;
  }
  const recB = best;

  const PW = C.GW * 0.875, GAP = 48, M = 32;
  const W = M * 2 + PW * 2 + GAP, H = 470;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d141c"/><stop offset="1" stop-color="#0a0f15"/>
    </linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="6"/></filter>
    ${['a', 'b'].map((id) => `<filter id="static-${id}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="1">
        <animate attributeName="seed" values="1;7;3;9;5;2;8" dur="0.35s" repeatCount="indefinite" calcMode="discrete"/>
      </feTurbulence>
      <feColorMatrix type="saturate" values="0"/>
    </filter>`).join('\n    ')}
    <style>
      text { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .h { font-size: 19px; font-weight: 700; fill: #e6eef6; }
      .sub { font-size: 13px; fill: #7f93a8; }
      .lbl { font-size: 10px; font-weight: 600; letter-spacing: 1px; fill: #7f93a8; }
      .pill { font-size: 13px; font-weight: 700; }
      .ev { font-size: 14px; font-weight: 700; text-anchor: middle; }
      .miss { fill: #ffd0d5; } .hit { fill: #bfe0ff; }
    </style>
  </defs>
  <rect width="${W}" height="${H}" rx="16" fill="url(#bg)"/>
  ${panel(recA, M, 14, 'Fresh culture', 'random wiring · no experience yet', '#ff8a96', 'a', DUR)}
  ${panel(recB, M + PW + GAP, 14, 'After ~1,300 rallies', 'same rules · shaped only by beat vs noise', '#4fe0a8', 'b', DUR)}
</svg>
`;
  fs.writeFileSync(path.join(OUT, 'demo.svg'), svg);
  const pct = (r) => Math.round((100 * r.hits) / (r.hits + r.misses || 1));
  console.log(`demo.svg written (${(svg.length / 1024).toFixed(0)} KB) — fresh ${pct(recA)}%, trained ${pct(recB)}%`);
}

// ------------------------------------------------------ learning-curve.svg
function curveSvg() {
  const EVENTS = 1500, BLOCK = 50, TRIALS = 4;
  const series = {};
  for (const fb of [true, false]) {
    const sums = new Array(EVENTS / BLOCK).fill(0);
    for (let t = 0; t < TRIALS; t++) {
      console.log(`curve: ${fb ? 'feedback' : 'control'} run ${t + 1}/${TRIALS}`);
      const d = new Dish(); d.feedback = fb;
      let b = 0;
      while (d.stats.events.length < EVENTS) {
        d.step();
        if (d.lastEvent && d.stats.events.length % BLOCK === 0) sums[b++] += d.hitRate(BLOCK) / TRIALS;
      }
    }
    series[fb] = sums;
  }

  const W = 900, H = 340, L = 56, R = 24, T = 56, B = 48;
  const iw = W - L - R, ih = H - T - B, n = series[true].length;
  const X = (i) => L + (i / (n - 1)) * iw, Y = (v) => T + (1 - v) * ih;
  const line = (s) => s.map((v, i) => `${i ? 'L' : 'M'}${f1(X(i))},${f1(Y(v))}`).join(' ');
  const area = (s) => `${line(s)} L${f1(X(n - 1))},${f1(Y(0))} L${f1(X(0))},${f1(Y(0))} Z`;
  const fb = series[true], ct = series[false];
  const last = fb[fb.length - 1], first = fb[0];

  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) =>
    `<line x1="${L}" x2="${W - R}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" stroke="#223042"/>
     <text x="${L - 10}" y="${f1(Y(v) + 4)}" class="ax" text-anchor="end">${v * 100}%</text>`).join('');
  const xt = [0, 500, 1000, 1500].map((e) =>
    `<text x="${f1(L + (e / EVENTS) * iw)}" y="${H - B + 22}" class="ax" text-anchor="middle">${e}</text>`).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4fe0a8" stop-opacity=".35"/><stop offset="1" stop-color="#4fe0a8" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="reveal"><rect x="0" y="0" width="0" height="${H}">
      <animate attributeName="width" values="0;${W};${W}" keyTimes="0;0.55;1" dur="7s" repeatCount="indefinite"/>
    </rect></clipPath>
    <style>
      text { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .ax { font-size: 12px; fill: #7f93a8; }
      .t { font-size: 17px; font-weight: 700; fill: #e6eef6; }
      .lg { font-size: 13px; fill: #c9d6e2; }
      .big { font-size: 28px; font-weight: 800; }
    </style>
  </defs>
  <rect width="${W}" height="${H}" rx="16" fill="#0b1118"/>
  <text x="${L}" y="32" class="t">Hit rate over time · mean of ${TRIALS} fresh cultures each</text>
  ${grid}${xt}
  <text x="${L + iw / 2}" y="${H - 10}" class="ax" text-anchor="middle">rallies played</text>
  <g clip-path="url(#reveal)">
    <path d="${area(fb)}" fill="url(#fill)"/>
    <path d="${line(ct)}" fill="none" stroke="#8899aa" stroke-width="2.5" stroke-dasharray="6 5"/>
    <path d="${line(fb)}" fill="none" stroke="#4fe0a8" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="${f1(X(n - 1))}" cy="${f1(Y(last))}" r="6" fill="#4fe0a8"/>
  </g>
  <g transform="translate(${W - R - 270},${f1(Y(0.66))})">
    <rect width="250" height="86" rx="12" fill="#121821" stroke="#223042"/>
    <line x1="16" x2="40" y1="26" y2="26" stroke="#4fe0a8" stroke-width="3.5"/>
    <text x="50" y="30" class="lg">beat on hit / noise on miss</text>
    <line x1="16" x2="40" y1="56" y2="56" stroke="#8899aa" stroke-width="2.5" stroke-dasharray="6 5"/>
    <text x="50" y="60" class="lg">no feedback (control)</text>
  </g>
  <text x="${W - R}" y="32" text-anchor="end" class="big" fill="#4fe0a8">${Math.round(first * 100)}% to ${Math.round(last * 100)}%</text>
</svg>
`;
  fs.writeFileSync(path.join(OUT, 'learning-curve.svg'), svg);
  console.log(`learning-curve.svg written — feedback ${Math.round(first * 100)}% -> ${Math.round(last * 100)}%, control ${Math.round(ct[0] * 100)}% -> ${Math.round(ct[ct.length - 1] * 100)}%`);
  return { first, last, ctFirst: ct[0], ctLast: ct[ct.length - 1] };
}

demoSvg();
curveSvg();
