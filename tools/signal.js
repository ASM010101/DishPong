// Does the eligibility trace at event time carry information about hit vs miss?
// Usage: node tools/signal.js [key=value ...]
const Dish = require('../dish.js');
const d = new Dish();
d.lr = 0; // observe only
for (const p of process.argv.slice(2)) { const [k, v] = p.split('='); d[k] = +v; }
const { NS, NM, NU, NB } = d;
const ideal = new Float32Array(NS * NM);
for (let i = 0; i < NS; i++) for (let j = 0; j < NM; j++) {
  const pos = (i % NB) / (NB - 1);
  const v = i < NB ? 0.5 - pos : pos - 0.5;
  ideal[i * NM + j] = j < NU ? v : -v;
}
const orig = d._learn.bind(d);
const xs = [], ys = [];
d._learn = function (sign) {
  let p = 0;
  for (let k = 0; k < ideal.length; k++) p += ideal[k] * this.Es[k];
  xs.push(p); ys.push(sign > 0 ? 1 : 0);
  orig(sign);
};
while (d.stats.events.length < 1500) d.step();
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const mx = mean(xs), my = mean(ys);
let c = 0, vx = 0, vy = 0;
for (let i = 0; i < xs.length; i++) { c += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; vy += (ys[i] - my) ** 2; }
console.log('corr(trace·ideal, hit) =', (c / Math.sqrt(vx * vy)).toFixed(3),
  ' mean on hit', mean(xs.filter((_, i) => ys[i])).toFixed(2),
  ' on miss', mean(xs.filter((_, i) => !ys[i])).toFixed(2));
