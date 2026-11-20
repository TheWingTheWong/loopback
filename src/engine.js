// Loopback engine — pure, deterministic, dependency-free.
// Works in Node (tests) and the browser (game UI).
//
// Rules in one paragraph:
//   You control a robot for T steps. When the loop ends, that run becomes a
//   ghost that replays its exact positions in every later loop, and a fresh
//   robot starts again at S. Pressure plates (a, b, c) open the doors with the
//   matching capital letter (A, B, C) at any time step where *anything* (robot
//   or ghost) is standing on them. Reach the exit E within your loop budget.
//
// Move resolution at time t: the door state is computed from every entity's
// position at time t; an entity may step into a door cell only if it is open
// at that moment. Ghosts replay positions, so they can never be disrupted.

export const MOVES = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0], W: [0, 0] };
export const MOVE_KEYS = ['U', 'D', 'L', 'R', 'W'];

// ---------------------------------------------------------------- RNG ----
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

// -------------------------------------------------------------- Level ----
export function parseLevel(rows, { T, maxLoops = 3, par = null, seed = null } = {}) {
  if (!Number.isInteger(T) || T < 1) throw new Error('T (loop length) must be a positive integer');
  const h = rows.length;
  const w = rows[0].length;
  const N = w * h;
  const wall = new Uint8Array(N);
  const plateOf = new Int8Array(N).fill(-1);
  const doorOf = new Int8Array(N).fill(-1);
  let start = -1;
  let exit = -1;
  let P = 0;
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) throw new Error(`row ${y} has wrong width`);
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      const p = y * w + x;
      if (c === '#') wall[p] = 1;
      else if (c === 'S') start = p;
      else if (c === 'E') exit = p;
      else if (c >= 'a' && c <= 'c') { plateOf[p] = c.charCodeAt(0) - 97; P = Math.max(P, plateOf[p] + 1); }
      else if (c >= 'A' && c <= 'C') { doorOf[p] = c.charCodeAt(0) - 65; P = Math.max(P, doorOf[p] + 1); }
      else if (c !== '.') throw new Error(`unknown tile '${c}'`);
    }
  }
  if (start < 0 || exit < 0) throw new Error('level needs S and E');
  return { rows: rows.slice(), w, h, N, wall, plateOf, doorOf, start, exit, P, T, maxLoops, par, seed };
}

export const xy = (level, p) => [p % level.w, Math.floor(p / level.w)];

export function ownBits(level, p) {
  const k = level.plateOf[p];
  return k >= 0 ? 1 << k : 0;
}

/** Try to move from p; returns the resulting cell (p itself if blocked). */
export function step(level, p, move, mask) {
  if (move === 'W') return p;
  const d = MOVES[move];
  if (!d) throw new Error(`bad move ${move}`);
  const x = (p % level.w) + d[0];
  const y = Math.floor(p / level.w) + d[1];
  if (x < 0 || y < 0 || x >= level.w || y >= level.h) return p;
  const q = y * level.w + x;
  if (level.wall[q]) return p;
  const door = level.doorOf[q];
  if (door >= 0 && !((mask >> door) & 1)) return p;
  return q;
}

// A "schedule" is a BigInt with bit (t*P + k) set when plate k is held at time t.
const schedBit = (level, t, p) => {
  const k = level.plateOf[p];
  return k >= 0 ? 1n << BigInt(t * level.P + k) : 0n;
};

export function maskFromSchedule(level, G, t) {
  if (level.P === 0) return 0;
  return Number((G >> BigInt(t * level.P)) & BigInt((1 << level.P) - 1));
}

export function trajectory(level, moves, G = 0n) {
  const pos = [level.start];
  for (let t = 0; t < moves.length; t++) {
    const p = pos[t];
    pos.push(step(level, p, moves[t], maskFromSchedule(level, G, t) | ownBits(level, p)));
  }
  return pos;
}

export function scheduleOf(level, positions) {
  let s = 0n;
  positions.forEach((p, t) => { s |= schedBit(level, t, p); });
  return s;
}

// ------------------------------------------------------------- Solver ----
/** Shortest move list that reaches the exit within T steps, given ghost schedule G. */
export function solveFinalLoop(level, G) {
  const { N, T, start, exit } = level;
  const parent = new Int32Array(N * (T + 1)).fill(-1);
  const via = new Int8Array(N * (T + 1));
  const s0 = start; // id for (start, t=0)
  parent[s0] = s0;
  const queue = [s0];
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    const t = Math.floor(id / N);
    const p = id % N;
    if (p === exit) {
      const moves = [];
      for (let cur = id; cur !== s0; cur = parent[cur]) moves.push(MOVE_KEYS[via[cur]]);
      return moves.reverse();
    }
    if (t === T) continue;
    const mask = maskFromSchedule(level, G, t) | ownBits(level, p);
    for (let mi = 0; mi < 5; mi++) {
      const q = step(level, p, MOVE_KEYS[mi], mask);
      const nid = (t + 1) * N + q;
      if (parent[nid] === -1) { parent[nid] = id; via[nid] = mi; queue.push(nid); }
    }
  }
  return null;
}

function paretoInsert(list, cand, cap) {
  for (const e of list) if ((e.bits & cand.bits) === cand.bits) return false;
  for (let i = list.length - 1; i >= 0; i--) {
    if ((cand.bits & list[i].bits) === list[i].bits) list.splice(i, 1);
  }
  if (list.length < cap) { list.push(cand); return true; }
  return false;
}

/**
 * Every useful (Pareto-maximal) plate schedule a full-length non-final loop
 * can produce on top of ghost schedule G, each with the moves that make it.
 */
export function enumerateGhostRuns(level, G, cap = 160, work = { left: Infinity }) {
  const { T, start } = level;
  let layer = new Map([[start, [{ bits: schedBit(level, 0, start), parent: null, move: null }]]]);
  for (let t = 0; t < T; t++) {
    const next = new Map();
    for (const [p, entries] of layer) {
      const mask = maskFromSchedule(level, G, t) | ownBits(level, p);
      const seenQ = new Set();
      for (const m of MOVE_KEYS) {
        const q = step(level, p, m, mask);
        if (seenQ.has(q)) continue;
        seenQ.add(q);
        const add = schedBit(level, t + 1, q);
        let list = next.get(q);
        if (!list) next.set(q, (list = []));
        work.left -= entries.length;
        if (work.left < 0) throw new SolverBudgetError();
        for (const e of entries) paretoInsert(list, { bits: e.bits | add, parent: e, move: m }, cap);
      }
    }
    layer = next;
  }
  const finals = [];
  for (const entries of layer.values()) {
    for (const e of entries) if ((e.bits & ~G) !== 0n) paretoInsert(finals, e, cap * 4);
  }
  return finals.map((e) => {
    const moves = [];
    for (let cur = e; cur.parent; cur = cur.parent) moves.push(cur.move);
    return { bits: e.bits, moves: moves.reverse() };
  });
}

export class SolverBudgetError extends Error {
  constructor() { super('solver work budget exhausted'); }
}

/**
 * Find the fewest loops needed (then fewest final-loop moves).
 * Returns { loops, plan: [movesLoop1, ..., movesFinal] } or null.
 * Throws SolverBudgetError if `budget` units of work are exceeded.
 */
export function solve(level, maxLoops = level.maxLoops, budget = Infinity) {
  const work = { left: budget };
  let frontier = [{ G: 0n, ghosts: [] }];
  const seen = new Set(['0']);
  for (let loop = 1; loop <= maxLoops; loop++) {
    let best = null;
    for (const st of frontier) {
      const m = solveFinalLoop(level, st.G);
      if (m && (!best || m.length < best.final.length)) best = { st, final: m };
    }
    if (best) return { loops: loop, plan: [...best.st.ghosts, best.final] };
    if (loop === maxLoops) break;
    const next = [];
    for (const st of frontier) {
      for (const run of enumerateGhostRuns(level, st.G, 160, work)) {
        const G2 = st.G | run.bits;
        const key = G2.toString(36);
        if (seen.has(key)) continue;
        seen.add(key);
        paretoInsert(next, { bits: G2, G: G2, ghosts: [...st.ghosts, run.moves] }, 400);
      }
    }
    frontier = next;
  }
  return null;
}

// ---------------------------------------------------------- Generator ----
function transform(rows, rng) {
  let g = rows.map((r) => r.split(''));
  if (rng() < 0.5) g = g[0].map((_, x) => g.map((row) => row[x])); // transpose
  if (rng() < 0.5) g = g.map((row) => row.reverse());
  if (rng() < 0.5) g = g.reverse();
  return g.map((r) => r.join(''));
}

function shortestIgnoringDoors(rows) {
  const lvl = parseLevel(rows, { T: 1 });
  const dist = new Int32Array(lvl.N).fill(-1);
  dist[lvl.start] = 0;
  const q = [lvl.start];
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    for (const m of ['U', 'D', 'L', 'R']) {
      const n = step(lvl, p, m, 0b111);
      if (dist[n] === -1) { dist[n] = dist[p] + 1; q.push(n); }
    }
  }
  return dist[lvl.exit];
}

function tryBuild(rng, seed) {
  const S = 9; // 9x9 with a wall border -> 7x7 playfield
  const g = Array.from({ length: S }, (_, y) =>
    Array.from({ length: S }, (_, x) => (x === 0 || y === 0 || x === S - 1 || y === S - 1 ? '#' : '.')));
  const doors = rng() < 0.45 ? 1 : 2;
  const cols = doors === 1 ? [randInt(rng, 3, 5)] : (() => { const c1 = randInt(rng, 2, 3); return [c1, randInt(rng, c1 + 2, 6)]; })();
  cols.forEach((c, i) => {
    for (let y = 1; y < S - 1; y++) g[y][c] = '#';
    g[randInt(rng, 1, S - 2)][c] = String.fromCharCode(65 + i);
  });
  const region = (x) => cols.filter((c) => x > c).length;
  // sprinkle obstacles (never next to a door, to keep doors reachable)
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    if (g[y][x] !== '.' || cols.includes(x)) continue;
    const nearDoor = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => /[A-C]/.test(g[y + dy][x + dx]));
    if (!nearDoor && rng() < 0.17) g[y][x] = '#';
  }
  const freeIn = (r) => {
    const cells = [];
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) if (g[y][x] === '.' && region(x) === r) cells.push([x, y]);
    return cells;
  };
  const place = (r, ch) => {
    const cells = freeIn(r);
    if (!cells.length) return false;
    const [x, y] = cells[Math.floor(rng() * cells.length)];
    g[y][x] = ch;
    return true;
  };
  if (!place(0, 'S') || !place(doors, 'E') || !place(0, 'a')) return null;
  if (doors === 2 && !place(rng() < 0.75 ? 1 : 0, 'b')) return null;

  const rows = transform(g.map((r) => r.join('')), rng);
  const lower = shortestIgnoringDoors(rows);
  if (lower < 3) return null;
  const BUDGET = 400000;
  const at = (T) => solve(parseLevel(rows, { T, maxLoops: 3 }), 3, BUDGET);
  try {
    // Solvability is monotone in T (extra steps can be spent waiting), so binary-search the tightest T.
    let hi = Math.min(18, lower + 10);
    if (!at(hi)) return null;
    let lo = lower;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (at(mid)) hi = mid; else lo = mid + 1; }
    const level = parseLevel(rows, { T: hi + (rng() < 0.5 ? 1 : 2), maxLoops: 3, seed }); // breathing room
    const solution = solve(level, 3, BUDGET);
    if (!solution || solution.loops < 2) return null;
    level.par = solution.loops;
    return { level, solution };
  } catch (e) {
    if (e instanceof SolverBudgetError) return null;
    throw e;
  }
}

export const FALLBACK_ROWS = [
  '#########',
  '#S..#...#',
  '#.#.#.#.#',
  '#...A...#',
  '#.a.#.#.#',
  '#...#..E#',
  '#########',
];

/** Deterministic puzzle for a seed; guaranteed solvable in >= 2 loops. */
export function generateLevel(seed) {
  const rng = mulberry32(seed);
  for (let attempt = 0; attempt < 300; attempt++) {
    const built = tryBuild(rng, seed);
    if (built) return built;
  }
  const level = parseLevel(FALLBACK_ROWS, { T: 12, maxLoops: 3, seed });
  const solution = solve(level);
  level.par = solution.loops;
  return { level, solution };
}

// --------------------------------------------------------------- Game ----
export function newGame(level) {
  return { level, ghosts: [], ghostMoves: [], cur: [level.start], curMoves: [], won: false, lost: false };
}

export const timeOf = (game) => game.cur.length - 1;
export const loopIndex = (game) => game.ghosts.length;

export function ghostPositionsAt(game, t) {
  return game.ghosts.map((g) => g[Math.min(t, g.length - 1)]);
}

/** Door bitmask governing moves made at the current time step. */
export function currentMask(game) {
  const t = timeOf(game);
  let mask = ownBits(game.level, game.cur[t]);
  for (const p of ghostPositionsAt(game, t)) mask |= ownBits(game.level, p);
  return mask;
}

export function applyMove(game, move) {
  if (game.won || game.lost) return game;
  const { level } = game;
  const t = timeOf(game);
  const q = step(level, game.cur[t], move, currentMask(game));
  game.cur.push(q);
  game.curMoves.push(move);
  if (q === level.exit) {
    game.won = true;
  } else if (timeOf(game) === level.T) {
    game.ghosts.push(game.cur);
    game.ghostMoves.push(game.curMoves);
    if (game.ghosts.length >= level.maxLoops) game.lost = true;
    else { game.cur = [level.start]; game.curMoves = []; }
  }
  return game;
}

/** Wait out the rest of the current loop. */
export function endLoop(game) {
  const idx = loopIndex(game);
  while (!game.won && !game.lost && loopIndex(game) === idx) applyMove(game, 'W');
  return game;
}

export function undo(game) {
  if (game.won) { game.won = false; game.cur.pop(); game.curMoves.pop(); return game; }
  if (game.lost || game.cur.length === 1) {
    if (!game.ghosts.length) return game;
    game.cur = game.ghosts.pop();
    game.curMoves = game.ghostMoves.pop();
    game.lost = false;
  }
  game.cur.pop();
  game.curMoves.pop();
  return game;
}

export function totalMoves(game) {
  const count = (ms) => ms.filter((m) => m !== 'W').length;
  return game.ghostMoves.reduce((s, ms) => s + count(ms), 0) + count(game.curMoves);
}

// -------------------------------------------------------------- Daily ----
const EPOCH = Date.UTC(2026, 0, 1);
export const dayNumber = (date = new Date()) =>
  Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - EPOCH) / 86400000) + 1;
export const seedForDay = (day) => (Math.imul(day, 2654435761) ^ 0x5eed) >>> 0;

export function shareText({ label, loopsUsed, par, moves }) {
  const star = loopsUsed <= par ? ' ⭐' : '';
  return `Loopback ${label}\n${'👻'.repeat(loopsUsed - 1)}🤖 ${loopsUsed}/${par} loops${star}\n${moves} moves`;
}
