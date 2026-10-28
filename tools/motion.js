const Dish = require('../dish.js');
const d = new Dish(); d.lr = 0;
for (const p of process.argv.slice(2)) { const [k, v] = p.split('='); d[k] = +v; }
const ys = [];
for (let t = 0; t < 30000; t++) { d.step(); if (d.phase === 'play') ys.push(d.paddleY); }
let s = 0, n = 0; for (let i = 60; i < ys.length; i++) { s += (ys[i] - ys[i - 60]) ** 2; n++; }
const m = ys.reduce((a, b) => a + b, 0) / ys.length;
const sd = Math.sqrt(ys.reduce((a, b) => a + (b - m) ** 2, 0) / ys.length);
console.log(process.argv.slice(2).join(' '), 'rms 60-tick move', Math.sqrt(s / n).toFixed(1), 'px; paddle mean', m.toFixed(0), 'sd', sd.toFixed(0));
