// How well can the current body play with hand-set "ideal" weights?
// Usage: node tools/ideal.js [key=value ...]
const Dish = require('../dish.js');
const kv = process.argv.slice(2);
for (const scale of [0, 0.1, 0.2, 0.4, 0.8]) {
  const d = new Dish(); d.feedback = false;
  for (const p of kv) { const [k, v] = p.split('='); d[k] = +v; }
  const { NS, NM, NU, NB } = d;
  for (let i = 0; i < NS; i++) for (let j = 0; j < NM; j++) {
    const pos = (i % NB) / (NB - 1);
    let pref = ((i / NB) | 0) === 1 ? pos : 1 - pos; // paddle cells inverted
    if (j >= NU) pref = 1 - pref;
    d.Ws[i * NM + j] = Math.max(0, 0.08 + scale * (pref - 0.5));
  }
  while (d.stats.events.length < 400) d.step();
  console.log('scale', scale, 'hit', (d.hitRate(400) * 100).toFixed(1) + '%');
}
