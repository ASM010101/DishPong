// Builds a self-contained Playwright snippet (page inlined) for headless browser checks.
// Usage: node tools/make-browser-test.js <outFile> <seconds at 64x> [screenshotDir]
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'dish.js'), 'utf8');
html = html.replace('<script src="dish.js"></script>', () => '<script>' + js + '</script>');
const secs = +process.argv[3] || 20;
const shots = path.resolve(process.argv[4] || '.');
const code = `async (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1180, height: 1480 });
  await page.setContent(${JSON.stringify(html)});
  await page.click('#overlay');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: ${JSON.stringify(path.join(shots, 'dishpong-start.png'))} });
  await page.click('[data-speed="64"]');
  await page.waitForTimeout(${secs * 1000});
  await page.click('[data-speed="1"]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: ${JSON.stringify(path.join(shots, 'dishpong-trained.png'))}, fullPage: true });
  const r = await page.evaluate(() => {
    const t = (id) => document.getElementById(id).textContent;
    return { rate: t('sRate'), hits: t('sHits'), misses: t('sMiss'), best: t('sBest'), time: t('sTime') };
  });
  return JSON.stringify({ ...r, errors });
}`;
fs.writeFileSync(process.argv[2], code);
