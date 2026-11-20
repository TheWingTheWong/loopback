// Takes the README screenshot (docs/screenshot.png) with Playwright: `node scripts/screenshot.mjs`
import { createRequire } from "node:module";
import { startServer } from "../serve.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const out = new URL("../docs/screenshot.png", import.meta.url).pathname;
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 860 }, deviceScaleFactor: 2 });
  await page.goto(`${base}?seed=42`);
  await page.waitForFunction(() => window.__loopback?.level);
  const KEY = { U: "ArrowUp", D: "ArrowDown", L: "ArrowLeft", R: "ArrowRight", W: " " };
  const plan = await page.evaluate(() => window.__loopback.solution.plan);
  // play the solver's run up to the middle of the last loop, so ghosts are on the board
  for (const [li, loop] of plan.entries()) {
    const last = li === plan.length - 1;
    for (const m of last ? loop.slice(0, Math.floor(loop.length / 2)) : loop) await page.keyboard.press(KEY[m]);
    if (!last && (await page.evaluate(() => window.__loopback.game.ghosts.length)) === li) await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(2500); // let the loop banner fade
  await page.screenshot({ path: out });
  console.log("wrote", out);
} finally { await browser.close(); server.close(); }
