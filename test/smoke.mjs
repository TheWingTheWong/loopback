// End-to-end: serve the page, load puzzles in headless Chromium, play the
// solver's solution with real key presses and check the win screen.
import { createRequire } from 'node:module';

// Works with a local `npm i -D playwright` or a globally installed copy.
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import { startServer } from '../serve.mjs';

const KEY = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight', W: ' ' };
const shotDir = process.env.SHOT_DIR;

const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // 1. daily puzzle boots
  await page.goto(base);
  await page.waitForFunction(() => window.__loopback?.level);
  assert.match(await page.textContent('#title'), /Puzzle #\d+/);

  for (const seed of [42, 73, 2026]) {
    await page.goto(`${base}?seed=${seed}`);
    await page.waitForFunction(() => window.__loopback?.level);
    const { plan, T, par } = await page.evaluate(() => ({
      plan: window.__loopback.solution.plan, T: window.__loopback.level.T, par: window.__loopback.level.par,
    }));
    assert.equal(plan.length, par);
    if (shotDir && seed === 42) await page.screenshot({ path: `${shotDir}/start.png` });

    for (const [li, loop] of plan.entries()) {
      for (const [i, m] of loop.entries()) {
        await page.keyboard.press(KEY[m]);
        if (shotDir && seed === 42 && li === plan.length - 1 && i === Math.floor(loop.length / 2)) {
          await page.waitForTimeout(200);
          await page.screenshot({ path: `${shotDir}/midplay.png` });
        }
      }
      if (li < plan.length - 1) {
        const state = await page.evaluate(() => ({ loop: window.__loopback.game.ghosts.length, t: window.__loopback.game.cur.length - 1 }));
        assert.deepEqual(state, { loop: li + 1, t: 0 }, `seed ${seed}: loop ${li + 1} rolled over after ${T} steps`);
      }
    }
    await page.waitForSelector('#overlay.show', { timeout: 3000 });
    const share = await page.textContent('#share');
    assert.match(share, new RegExp(`${par}/${par} loops ⭐`));
    if (shotDir && seed === 42) await page.screenshot({ path: `${shotDir}/win.png` });
    console.log(`✓ seed ${seed}: solved in ${par} loops (T=${T}) via keyboard`);
  }

  // 2. undo + end loop buttons
  await page.goto(`${base}?seed=42`);
  await page.waitForFunction(() => window.__loopback?.level);
  await page.keyboard.press('ArrowRight');
  await page.click('#undoBtn');
  assert.equal(await page.evaluate(() => window.__loopback.game.cur.length), 1);
  await page.click('#endBtn');
  assert.equal(await page.evaluate(() => window.__loopback.game.ghosts.length), 1);
  console.log('✓ undo / end-loop buttons');

  // 3. canvas actually renders something
  const lit = await page.evaluate(() => {
    const d = document.getElementById('cv').getContext('2d').getImageData(0, 0, 900, 900).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n;
  });
  assert.ok(lit > 500000, 'canvas drew pixels');
  console.log('✓ canvas renders');

  assert.deepEqual(errors, [], 'no console errors');
  console.log('✓ no console errors');
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
