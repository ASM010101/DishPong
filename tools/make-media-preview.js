// Builds a Playwright snippet that renders docs/*.svg as <img> tags (like GitHub does) and screenshots them.
// Usage: node tools/make-media-preview.js <outFile> <screenshotPath>
const fs = require('fs');
const path = require('path');
const docs = path.join(__dirname, '..', 'docs');
const imgs = ['demo.svg', 'learning-curve.svg'].map((f) =>
  'data:image/svg+xml;base64,' + fs.readFileSync(path.join(docs, f)).toString('base64'));
const html = `<body style="margin:0;background:#0d1117;padding:20px">${imgs
  .map((src) => `<img src="${src}" width="900" style="display:block;margin-bottom:20px">`).join('')}</body>`;
const code = `async (page) => {
  await page.setViewportSize({ width: 960, height: 900 });
  await page.setContent(${JSON.stringify(html)});
  await page.waitForTimeout(6000);
  await page.screenshot({ path: ${JSON.stringify(process.argv[3])} });
  return 'ok';
}`;
fs.writeFileSync(process.argv[2], code);
