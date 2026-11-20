import {
  generateLevel, newGame, applyMove, undo, endLoop, timeOf, loopIndex, ghostPositionsAt,
  currentMask, totalMoves, ownBits, dayNumber, seedForDay, shareText,
} from './engine.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv');
const ctx = cv.getContext('2d');

// Three spot inks + a yellow for the exit mark. Colour layers print with
// `multiply` and a slight offset, like a risograph run.
const INK = '#1e1c1a', PAPER = '#f3eee3', YELLOW = '#ffd93b';
const PLATE = ['#ff4fa0', '#1d6fd6', '#ff7a29'];
const PLATE_NAMES = ['Pink', 'Blue', 'Orange'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const DISPLAY = '"Bricolage", "Arial Narrow", sans-serif';
const MONO = '"Plex Mono", ui-monospace, monospace';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let level, solution, game, label, demoTimer = null;
let anim = null;
let fx = { rewind: null, bump: null, win: null };
let facing = [0, 1];

// ----------------------------------------------------------------- load ----
function load(seed, lbl) {
  stopDemo();
  ({ level, solution } = generateLevel(seed));
  game = newGame(level);
  label = lbl;
  anim = null;
  fx = { rewind: null, bump: null, win: null };
  facing = [0, 1];
  const url = new URL(location.href);
  const isDaily = lbl.startsWith('#');
  if (isDaily) url.searchParams.delete('seed'); else url.searchParams.set('seed', seed);
  history.replaceState(null, '', url);
  $('title').textContent = `Puzzle ${lbl}`;
  $('issueNo').textContent = isDaily ? `No. ${lbl.slice(1)}` : 'Off-print';
  $('issueDate').textContent = isDaily
    ? new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : `seed ${seed}`;
  $('dayChip').textContent = isDaily ? 'Today’s puzzle, same for everyone' : 'A one-off puzzle from a random seed';
  $('slugL').textContent = `Plate ${lbl} · ${level.T} steps per loop`;
  $('overlay').classList.remove('show');
  setStatus(`Each loop lasts ${level.T} steps. Escape within ${level.par} loops to make par.`);
  updatePanel();
}

function setStatus(msg, warn = false) {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('warn', warn);
}

// ---------------------------------------------------------------- input ----
function act(fn, { fromDemo = false, move = null } = {}) {
  if (!fromDemo) { stopDemo(); game.solvedByDemo = false; }
  if (game.won && fn !== undo) return;
  const t0 = timeOf(game);
  const before = { live: game.cur[t0], ghosts: ghostPositionsAt(game, t0), loop: loopIndex(game) };
  fn(game);
  const now = performance.now();
  const t = timeOf(game);

  if (move && move !== 'W') {
    const d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[move];
    facing = d;
    const after = loopIndex(game) === before.loop ? game.cur[t] : game.ghosts[before.loop][t0 + 1];
    if (after === before.live) fx.bump = { start: now, dir: d };
  }

  if (loopIndex(game) > before.loop && !game.won) {
    anim = null;
    fx.rewind = { start: now, loop: loopIndex(game) };
    if (game.lost) setStatus('Out of loops. Undo with Z, or start over with R.', true);
    else setStatus(`Loop ${ROMAN[loopIndex(game)]}. Your last run is now ghost ${loopIndex(game)}, and it will repeat exactly.`);
  } else if (loopIndex(game) < before.loop) {
    anim = null;
    setStatus('');
  } else {
    anim = { from: before, start: now };
    if (t === 0) setStatus('');
  }
  if (game.won) {
    fx.win = { start: now };
    setTimeout(showWin, reduceMotion ? 0 : 750);
  }
  updatePanel();
}

const KEYMAP = {
  ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
  w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R', ' ': 'W', '.': 'W',
};
const doMove = (m) => act((g) => applyMove(g, m), { move: m });
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if ($('overlay').classList.contains('show')) {
    if (e.key === 'Escape') $('overlay').classList.remove('show');
    else if (e.key === 'Enter' || e.key === 'n' || e.key === 'N') { e.preventDefault(); randomPuzzle(); }
    return;
  }
  if (KEYMAP[e.key]) { e.preventDefault(); doMove(KEYMAP[e.key]); }
  else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') { e.preventDefault(); act(undo); }
  else if (e.key === 'Enter') { e.preventDefault(); act(endLoop); }
  else if (e.key === 'r' || e.key === 'R') load(level.seed, label);
  else if (e.key === 'n' || e.key === 'N') randomPuzzle();
  else if (e.key === '?') watchSolution();
});
document.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => doMove(b.dataset.move)));

let touch0 = null;
cv.addEventListener('pointerdown', (e) => { touch0 = [e.clientX, e.clientY]; });
cv.addEventListener('pointerup', (e) => {
  if (!touch0) return;
  const dx = e.clientX - touch0[0], dy = e.clientY - touch0[1];
  touch0 = null;
  if (Math.hypot(dx, dy) < 20) return doMove('W');
  doMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'));
});

$('undoBtn').onclick = () => act(undo);
$('endBtn').onclick = () => act(endLoop);
$('resetBtn').onclick = () => load(level.seed, label);
$('newBtn').onclick = randomPuzzle;
$('nextBtn').onclick = randomPuzzle;
$('dailyBtn').onclick = daily;
$('watchBtn').onclick = watchSolution;
$('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') $('overlay').classList.remove('show'); });
$('copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText($('share').textContent); $('copyBtn').textContent = 'Copied'; }
  catch { $('copyBtn').textContent = 'Copy failed'; }
};

function randomPuzzle() { const s = (Math.random() * 2 ** 31) >>> 0; load(s, `~${s}`); }
function daily() { const d = dayNumber(); load(seedForDay(d), `#${d}`); }

function watchSolution() {
  load(level.seed, label);
  const moves = solution.plan.flat();
  game.solvedByDemo = true;
  let i = 0;
  setStatus('Playing the solver’s route. Press any key to take over.');
  demoTimer = setInterval(() => {
    if (i >= moves.length || game.won) return stopDemo();
    const m = moves[i++];
    act((g) => applyMove(g, m), { fromDemo: true, move: m });
  }, 160);
}
function stopDemo() { if (demoTimer) { clearInterval(demoTimer); demoTimer = null; } }

function showWin() {
  if (!game.won) return;
  if (demoTimer || game.solvedByDemo) { setStatus('That’s the solver’s route. Press R to try it yourself.'); return; }
  const loopsUsed = loopIndex(game) + 1;
  const perfect = loopsUsed <= level.par;
  const moves = totalMoves(game);
  $('stamp').textContent = perfect ? 'On par' : 'Escaped';
  $('winTitle').textContent = perfect ? 'Clean print.' : 'Out of the loop.';
  $('winText').textContent = perfect
    ? 'You escaped in the fewest loops possible.'
    : `You escaped, but it can be done in ${level.par} loop${level.par > 1 ? 's' : ''}. Try again?`;
  $('sLoops').textContent = loopsUsed;
  $('sPar').textContent = level.par;
  $('sMoves').textContent = moves;
  $('share').textContent = shareText({ label, loopsUsed, par: level.par, moves });
  $('copyBtn').textContent = 'Copy result';
  $('overlay').classList.add('show');
  $('nextBtn').focus();
}

// ---------------------------------------------------------------- panel ----
function updatePanel() {
  const t = timeOf(game);
  const L = loopIndex(game);
  $('stepLbl').innerHTML = `${String(t).padStart(2, '0')}<small>/ ${level.T} steps</small>`;
  $('parLbl').textContent = level.par;
  $('loops').innerHTML = Array.from({ length: level.maxLoops }, (_, i) => {
    const used = i < L, cur = i === L && !game.lost;
    const cls = [used && 'used', cur && 'cur', i === level.par - 1 && 'par'].filter(Boolean).join(' ');
    const txt = used ? `ghost ${i + 1}` : cur ? 'you' : 'unused';
    return `<div class="slot ${cls}"><b>${ROMAN[i]}</b><span>${txt}</span></div>`;
  }).join('');

  const cols = `grid-template-columns: repeat(${level.T + 1}, 1fr)`;
  let html = `<div class="tl-label">Step</div><div class="tl-row steps" style="${cols}">` +
    Array.from({ length: level.T + 1 }, (_, i) => `<div class="tl-cell ${i < t ? 'done' : i === t ? 'now' : ''}"></div>`).join('') + '</div>';
  for (let k = 0; k < level.P; k++) {
    html += `<div class="tl-label"><span class="sw" style="background:${PLATE[k]}"></span>${PLATE_NAMES[k]}</div>` +
      `<div class="tl-row plate" style="${cols}" title="Steps where a ghost holds the ${PLATE_NAMES[k].toLowerCase()} plate">` +
      Array.from({ length: level.T + 1 }, (_, i) => {
        const held = game.ghosts.some((g) => (ownBits(level, g[Math.min(i, g.length - 1)]) >> k) & 1);
        return `<div class="tl-cell ${held ? 'held' : ''} ${i === t ? 'now' : ''}" style="${held ? `background:${PLATE[k]}` : ''}"></div>`;
      }).join('') + '</div>';
  }
  $('timeline').innerHTML = html;
}

// ------------------------------------------------------------- textures ----
function makePattern(size, paint) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  return ctx.createPattern(c, 'repeat');
}
const HATCH = makePattern(12, (g, s) => {
  g.strokeStyle = '#1e1c1acc'; g.lineWidth = 1.6;
  g.beginPath();
  for (let o = -s; o <= s; o += s) { g.moveTo(o, s); g.lineTo(o + s, 0); }
  g.stroke();
});
const HALFTONE = makePattern(7, (g) => { g.fillStyle = INK; g.beginPath(); g.arc(3.5, 3.5, 1.7, 0, Math.PI * 2); g.fill(); });
const GRAIN = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 180;
  const g = c.getContext('2d'); const img = g.createImageData(180, 180);
  let seed = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const v = seed % 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 22;
  }
  g.putImageData(img, 0, 0);
  return ctx.createPattern(c, 'repeat');
})();

// ----------------------------------------------------------------- draw ----
const ease = (k) => 1 - (1 - k) ** 3;
const lerp = (a, b, k) => a + (b - a) * k;

function geometry() {
  const { w, h } = level;
  const cell = Math.floor(Math.min(cv.width / w, cv.height / h));
  const ox = (cv.width - cell * w) / 2, oy = (cv.height - cell * h) / 2;
  return { cell, ox, oy, cx: (p) => ox + ((p % w) + 0.5) * cell, cy: (p) => oy + (Math.floor(p / w) + 0.5) * cell };
}

function rr(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Spot-colour layer: multiply blend, nudged off-register. */
function inkLayer(draw, dx = 0, dy = 0) {
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.translate(dx, dy); draw(); ctx.restore();
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!level) return;
  const { cell, ox, oy, cx, cy } = geometry();
  const time = reduceMotion ? 0 : now / 1000;
  const k = anim ? ease(Math.min(1, (now - anim.start) / 120)) : 1;
  const t = timeOf(game);
  const mask = currentMask(game);
  const { w, h } = level;
  const mr = cell * 0.035; // misregistration
  const X = (p) => ox + (p % w) * cell, Y = (p) => oy + Math.floor(p / w) * cell;
  const isWall = (x, y) => x < 0 || y < 0 || x >= w || y >= h || level.wall[y * w + x];

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cv.width, cv.height);

  // floor grid: tick marks at tile corners
  ctx.strokeStyle = '#1e1c1a33'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let p = 0; p < level.N; p++) {
    if (level.wall[p]) continue;
    const x = X(p), y = Y(p), s = cell * 0.07;
    for (const [px, py] of [[x, y], [x + cell, y], [x, y + cell], [x + cell, y + cell]]) {
      ctx.moveTo(px - s, py); ctx.lineTo(px + s, py); ctx.moveTo(px, py - s); ctx.lineTo(px, py + s);
    }
  }
  ctx.stroke();

  // walls: hatched, with a firm outline where they meet the floor
  ctx.fillStyle = HATCH;
  for (let p = 0; p < level.N; p++) if (level.wall[p]) ctx.fillRect(X(p), Y(p), cell, cell);
  ctx.strokeStyle = INK; ctx.lineWidth = cell * 0.045; ctx.lineCap = 'square';
  ctx.beginPath();
  for (let p = 0; p < level.N; p++) {
    if (!level.wall[p]) continue;
    const x = p % w, y = Math.floor(p / w), px = X(p), py = Y(p);
    if (!isWall(x, y - 1)) { ctx.moveTo(px, py); ctx.lineTo(px + cell, py); }
    if (!isWall(x, y + 1)) { ctx.moveTo(px, py + cell); ctx.lineTo(px + cell, py + cell); }
    if (!isWall(x - 1, y)) { ctx.moveTo(px, py); ctx.lineTo(px, py + cell); }
    if (!isWall(x + 1, y)) { ctx.moveTo(px + cell, py); ctx.lineTo(px + cell, py + cell); }
  }
  ctx.stroke();
  ctx.lineWidth = 3; ctx.strokeRect(ox + 1.5, oy + 1.5, cell * w - 3, cell * h - 3);

  // start: registration cross
  {
    const x = cx(level.start), y = cy(level.start), r = cell * 0.28;
    ctx.strokeStyle = '#1e1c1a66'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.moveTo(x - r * 1.4, y); ctx.lineTo(x + r * 1.4, y); ctx.moveTo(x, y - r * 1.4); ctx.lineTo(x, y + r * 1.4); ctx.stroke();
  }

  // plates
  for (let p = 0; p < level.N; p++) {
    const kk = level.plateOf[p];
    if (kk < 0) continue;
    const held = (mask >> kk) & 1, x = cx(p), y = cy(p), r = cell * 0.34;
    inkLayer(() => {
      ctx.fillStyle = PLATE[kk]; ctx.globalAlpha = held ? 1 : 0.28;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }, -mr, -mr);
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + mr, y + mr, r, 0, Math.PI * 2); ctx.stroke();
    if (held) { // pressed: radiating ticks
      ctx.lineWidth = 2.5; ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + time * 0.6;
        ctx.moveTo(x + Math.cos(a) * r * 1.12, y + Math.sin(a) * r * 1.12);
        ctx.lineTo(x + Math.cos(a) * r * 1.32, y + Math.sin(a) * r * 1.32);
      }
      ctx.stroke();
    }
  }

  // doors
  for (let p = 0; p < level.N; p++) {
    const kk = level.doorOf[p];
    if (kk < 0) continue;
    const open = (mask >> kk) & 1, x = X(p), y = Y(p), m = cell * 0.08;
    const vertical = level.wall[p - 1] || level.wall[p + 1];
    if (open) {
      ctx.strokeStyle = PLATE[kk]; ctx.lineWidth = 3; ctx.setLineDash([cell * 0.08, cell * 0.07]);
      ctx.strokeRect(x + m, y + m, cell - 2 * m, cell - 2 * m); ctx.setLineDash([]);
      ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.lineCap = 'round';
      const mx = x + cell / 2, my = y + cell / 2, s = cell * 0.09;
      ctx.beginPath();
      if (vertical) for (const d of [-1, 1]) { ctx.moveTo(mx - s, my + d * s * 0.5); ctx.lineTo(mx, my + d * s * 1.5); ctx.lineTo(mx + s, my + d * s * 0.5); }
      else for (const d of [-1, 1]) { ctx.moveTo(mx + d * s * 0.5, my - s); ctx.lineTo(mx + d * s * 1.5, my); ctx.lineTo(mx + d * s * 0.5, my + s); }
      ctx.stroke();
    } else {
      inkLayer(() => { ctx.fillStyle = PLATE[kk]; ctx.fillRect(x + m * 0.5, y + m * 0.5, cell - m, cell - m); }, -mr, -mr);
      ctx.save(); ctx.beginPath(); ctx.rect(x + m * 0.5 + mr, y + m * 0.5 + mr, cell - m, cell - m); ctx.clip();
      ctx.fillStyle = HATCH; ctx.globalAlpha = 0.55; ctx.fillRect(x, y, cell, cell); ctx.restore();
      ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
      ctx.strokeRect(x + m * 0.5 + mr, y + m * 0.5 + mr, cell - m, cell - m);
      // keyhole
      const mx = x + cell / 2 + mr, my = y + cell / 2 + mr;
      ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(mx, my, cell * 0.14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(mx, my - cell * 0.03, cell * 0.035, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(mx - cell * 0.015, my - cell * 0.02, cell * 0.03, cell * 0.08);
    }
  }

  // exit: registration target
  {
    const x = cx(level.exit), y = cy(level.exit), r = cell * 0.36;
    inkLayer(() => { ctx.fillStyle = YELLOW; ctx.beginPath(); ctx.arc(x, y, r * 0.95, 0, Math.PI * 2); ctx.fill(); }, -mr, -mr);
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r * 1.3, y); ctx.lineTo(x + r * 1.3, y); ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x, y + r * 1.3); ctx.stroke();
    ctx.save(); ctx.translate(x, y); ctx.rotate(time * 0.5);
    ctx.setLineDash([cell * 0.05, cell * 0.07]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.22, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  // ghost routes: dotted ink lines from now to the end of their loop
  game.ghosts.forEach((g, gi) => {
    const off = (gi - (game.ghosts.length - 1) / 2) * cell * 0.08;
    ctx.strokeStyle = INK; ctx.globalAlpha = 0.55; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash([0.1, cell * 0.11]);
    ctx.beginPath();
    for (let i = t; i < g.length; i++) (i === t ? ctx.moveTo : ctx.lineTo).call(ctx, cx(g[i]) + off, cy(g[i]) + off);
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const end = g[g.length - 1], s = cell * 0.07; // end-of-run mark
    if (end !== g[t]) {
      ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(cx(end) + off - s, cy(end) + off - s); ctx.lineTo(cx(end) + off + s, cy(end) + off + s);
      ctx.moveTo(cx(end) + off + s, cy(end) + off - s); ctx.lineTo(cx(end) + off - s, cy(end) + off + s); ctx.stroke();
    }
  });

  const from = anim && anim.from.loop === loopIndex(game) ? anim.from : null;
  ghostPositionsAt(game, t).forEach((p, gi) => {
    const a = from ? from.ghosts[gi] ?? p : p;
    drawGhost(lerp(cx(a), cx(p), k), lerp(cy(a), cy(p), k), cell, gi + 1);
  });

  {
    const p = game.cur[t], a = from ? from.live : p;
    let x = lerp(cx(a), cx(p), k), y = lerp(cy(a), cy(p), k);
    if (fx.bump) {
      const b = (now - fx.bump.start) / 170;
      if (b < 1) { const s = Math.sin(b * Math.PI) * cell * 0.1; x += fx.bump.dir[0] * s; y += fx.bump.dir[1] * s; }
      else fx.bump = null;
    }
    if (!game.lost) drawRobot(x, y, cell, mr);
  }

  // win: ink rings spread out from the exit
  if (fx.win && !reduceMotion) {
    const e = (now - fx.win.start) / 1100;
    if (e < 1) for (let i = 0; i < 3; i++) {
      const q = Math.max(0, e - i * 0.12);
      inkLayer(() => {
        ctx.strokeStyle = PLATE[i % 2]; ctx.globalAlpha = 1 - q; ctx.lineWidth = cell * 0.12 * (1 - q);
        ctx.beginPath(); ctx.arc(cx(level.exit), cy(level.exit), cell * (0.4 + q * 4), 0, Math.PI * 2); ctx.stroke();
      });
    }
  }

  // rewind: a blue ink band wipes across with the new loop number
  if (fx.rewind) {
    const r = (now - fx.rewind.start) / 950;
    if (r >= 1 || reduceMotion) fx.rewind = null;
    else {
      const inP = ease(Math.min(1, r / 0.35)), outP = r > 0.7 ? ease((r - 0.7) / 0.3) : 0;
      const bandH = cell * 1.9, by = cv.height / 2 - bandH / 2;
      const x0 = cv.width * outP, x1 = cv.width * inP;
      inkLayer(() => { ctx.fillStyle = game.lost ? PLATE[0] : PLATE[1]; ctx.fillRect(x0, by, x1 - x0, bandH); });
      ctx.save(); ctx.beginPath(); ctx.rect(x0, by, x1 - x0, bandH); ctx.clip();
      ctx.fillStyle = PAPER; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.round(cell * 0.95)}px ${DISPLAY}`;
      ctx.fillText(game.lost ? 'Out of loops' : `Loop ${ROMAN[fx.rewind.loop]}`, cv.width / 2, cv.height / 2 - cell * 0.12);
      ctx.font = `600 ${Math.round(cell * 0.2)}px ${MONO}`;
      ctx.fillText(game.lost ? 'UNDO (Z) OR RESET (R)' : `GHOST ${fx.rewind.loop} IS NOW REPLAYING YOUR LAST RUN`, cv.width / 2, cv.height / 2 + cell * 0.55);
      ctx.restore();
    }
  }

  // paper grain over everything
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = GRAIN; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.globalCompositeOperation = 'source-over';
}

function drawRobot(x, y, cell, mr) {
  const s = cell * 0.58;
  inkLayer(() => { ctx.fillStyle = PLATE[0]; rr(x - s / 2, y - s / 2, s, s, s * 0.24); ctx.fill(); }, mr * 2.2, mr * 2.2);
  ctx.fillStyle = INK; rr(x - s / 2, y - s / 2, s, s, s * 0.24); ctx.fill();
  // eyes look where you last moved
  const ex = facing[0] * s * 0.1, ey = facing[1] * s * 0.08;
  ctx.fillStyle = PAPER;
  const ew = s * 0.13, eh = s * 0.24;
  for (const sx of [-1, 1]) ctx.fillRect(x + sx * s * 0.17 - ew / 2 + ex, y - s * 0.12 - eh / 2 + ey, ew, game.won ? ew : eh);
}

function drawGhost(x, y, cell, n) {
  const s = cell * 0.58;
  ctx.fillStyle = PAPER; rr(x - s / 2, y - s / 2, s, s, s * 0.24); ctx.fill();
  ctx.fillStyle = HALFTONE; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
  // badge with its loop number
  const bx = x + s / 2, by = y - s / 2, br = cell * 0.15;
  ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = INK; ctx.font = `800 ${Math.round(cell * 0.2)}px ${DISPLAY}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ROMAN[n - 1] ?? String(n), bx, by + 1);
}

// ----------------------------------------------------------------- boot ----
const qs = new URLSearchParams(location.search);
if (qs.has('seed')) { const s = Number(qs.get('seed')) >>> 0; load(s, `~${s}`); } else daily();
requestAnimationFrame(frame);

// test/debug hook
window.__loopback = {
  get level() { return level; }, get solution() { return solution; }, get game() { return game; },
};
