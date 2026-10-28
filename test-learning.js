// Headless check that the dish actually gets better at Pong.
// Compares the normal culture (calm beat on hits, noise on misses) with a
// control culture that receives no feedback (and therefore never learns).
// Usage: node test-learning.js [events] [block]
const Dish = require('./dish.js');
const EVENTS = +process.argv[2] || 1500;
const BLOCK = +process.argv[3] || 100;

function run(feedback) {
  const d = new Dish();
  d.feedback = feedback;
  const blocks = [];
  while (d.stats.events.length < EVENTS) {
    d.step();
    if (d.lastEvent && d.stats.events.length % BLOCK === 0) blocks.push(d.hitRate(BLOCK));
  }
  return { blocks, minutes: d.t / 60 / 60 };
}

const fmt = (b) => b.map((x) => (x * 100).toFixed(0).padStart(3)).join(' ');
const trials = 4;
let ok = true;
const summary = {};
for (const fb of [true, false]) {
  const label = fb ? 'FEEDBACK (learning)' : 'NO FEEDBACK (control)';
  console.log(`${label} — hit % per ${BLOCK} rallies`);
  let first = 0, last = 0;
  for (let t = 0; t < trials; t++) {
    const { blocks, minutes } = run(fb);
    console.log(`  ${fmt(blocks)}   (${minutes.toFixed(1)} game-min at 1x)`);
    first += blocks[0] / trials;
    last += blocks[blocks.length - 1] / trials;
  }
  console.log(`  mean: first ${(first * 100).toFixed(1)}%  ->  last ${(last * 100).toFixed(1)}%\n`);
  summary[fb] = { first, last };
}
ok = summary[true].last > summary[true].first + 0.2 && summary[true].last > summary[false].last + 0.2;
console.log(ok ? 'PASS: the culture gets clearly better, the control does not.' : 'FAIL: no clear learning.');
process.exit(ok ? 0 : 1);
