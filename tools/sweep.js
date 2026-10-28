// Parameter sweep: tracks weight "quality" (alignment with an ideal controller) and hit rate.
// Usage: node tools/sweep.js <lr> <traceDecay> [events] [key=value ...]
const Dish = require('../dish.js');
function quality(d) {
  const m = d.sensoryMap(), NB = d.NB; let q = 0, n = 0;
  for (let i = 0; i < d.NS; i++) {
    const pos = (i % NB) / (NB - 1);
    const ideal = ((i / NB) | 0) === 1 ? pos - 0.5 : 0.5 - pos;
    q += m[i] * ideal; n += ideal * ideal;
  }
  return q / n;
}
const [lr, decay, events = 2000, ...kv] = process.argv.slice(2);
const out = [];
for (let t = 0; t < 2; t++) {
  const d = new Dish(); d.lr = +lr; d.traceDecay = +decay;
  for (const p of kv) { const [k, v] = p.split('='); d[k] = +v; }
  const qs = [], hr = [];
  while (d.stats.events.length < +events) {
    d.step();
    if (d.lastEvent && d.stats.events.length % 500 === 0) {
      qs.push(quality(d).toFixed(3)); hr.push((d.hitRate(500) * 100).toFixed(0));
    }
  }
  out.push(`q[${qs}] hit[${hr}]`);
}
console.log(`lr=${lr} decay=${decay} ${kv.join(' ')}`, out.join(' | '));
