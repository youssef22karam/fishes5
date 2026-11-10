// Run against `npm run dev -- --host 127.0.0.1` to inspect representative heads.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = '.qa';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1120, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.FG?.App?.fish && window.FG?.hyperRig?.shot, null, { timeout: 120000 });

for (const id of (process.argv.slice(2).length ? process.argv.slice(2) : ['great-barracuda', 'largemouth-bass', 'shortfin-mako'])) {
  const result = await page.evaluate(async species => {
    const FG = window.FG;
    FG.App.testing = true;
    FG.doGenerate({ species, seed: 'arch:' + species });
    await new Promise(resolve => setTimeout(resolve, 300));
    const views = {};
    for (const view of ['headSide', 'mouthOpen', 'full']) {
      FG.hyperRig.goto(view);
      await new Promise(resolve => setTimeout(resolve, 80));
      views[view] = FG.hyperRig.shot(view);
    }
    FG.App.fish.uniforms.uJawAngle.value = 0;
    FG.App.fish.uniforms.uJawProtrude.value = 0;
    return {
      views,
      name: FG.App.genome?.meta?.name,
      audit: FG.hyperRig.validate(FG.App.fish),
      geometry: FG.checkFishGeometry(FG.App.fish).errors,
      tris: FG.App.fish.info.tris,
    };
  }, id);
  for (const [view, data] of Object.entries(result.views)) {
    writeFileSync(`${out}/${id}-${view}.png`, Buffer.from(data.split(',')[1], 'base64'));
  }
  console.log(id, result.name, result.tris, 'audit:', result.audit, 'geometry:', result.geometry);
}
console.log('Browser errors:', errors);
await browser.close();
if (errors.length) process.exitCode = 1;