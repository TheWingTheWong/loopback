import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, parseLevel, step, solve, solveFinalLoop, generateLevel, newGame, applyMove,
  undo, endLoop, timeOf, loopIndex, totalMoves, trajectory, scheduleOf, shareText,
  dayNumber, seedForDay, FALLBACK_ROWS,
} from '../src/engine.js';

// Exit sealed behind door A; plate a is far from the door, so you need a helper.
const TWO_LOOP = [
  '#######',
  '#a..S.#',
  '#####A#',
  '#....E#',
  '#######',
];

function play(level, plan) {
  const game = newGame(level);
  plan.forEach((loopMoves) => loopMoves.forEach((m) => applyMove(game, m)));
  return game;
}

test('rng is deterministic and in [0,1)', () => {
  const a = mulberry32(7), b = mulberry32(7);
  for (let i = 0; i < 100; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('parseLevel validates input', () => {
  assert.throws(() => parseLevel(['#S#'], { T: 3 }), /S and E/);
  assert.throws(() => parseLevel(['SEx'], { T: 3 }), /unknown tile/);
  assert.throws(() => parseLevel(['SE'], {}), /positive integer/);
  const lvl = parseLevel(TWO_LOOP, { T: 6 });
  assert.equal(lvl.P, 1);
  assert.equal(lvl.w, 7);
});

test('walls and closed doors block, open doors let you through', () => {
  const lvl = parseLevel(TWO_LOOP, { T: 6 });
  const doorAbove = lvl.w * 1 + 5; // cell above door A
  assert.equal(step(lvl, doorAbove, 'D', 0), doorAbove, 'closed door blocks');
  assert.equal(step(lvl, doorAbove, 'D', 1), doorAbove + lvl.w, 'open door passes');
  assert.equal(step(lvl, lvl.start, 'U', 0), lvl.start, 'wall blocks');
  assert.equal(step(lvl, lvl.start, 'W', 0), lvl.start);
});

test('solver: unsolvable alone, solvable with one ghost', () => {
  const lvl = parseLevel(TWO_LOOP, { T: 6 });
  assert.equal(solveFinalLoop(lvl, 0n), null);
  const sol = solve(lvl);
  assert.equal(sol.loops, 2);
  assert.equal(sol.plan[0].length, lvl.T, 'ghost loops are full length');
  const g = play(lvl, sol.plan);
  assert.ok(g.won);
  assert.equal(loopIndex(g), 1);
});

test('solver respects timing: too-short loop is unsolvable', () => {
  // ghost needs 3 steps to reach the plate, live needs 3 to reach the door: T=3 is too short
  assert.equal(solve(parseLevel(TWO_LOOP, { T: 3 })), null);
  assert.ok(solve(parseLevel(TWO_LOOP, { T: 5 })));
});

test('solver returns null when loop budget is too small', () => {
  const lvl = parseLevel(TWO_LOOP, { T: 6, maxLoops: 1 });
  assert.equal(solve(lvl), null);
});

test('ghost replay: trajectory and schedule line up with the game', () => {
  const lvl = parseLevel(TWO_LOOP, { T: 6 });
  const moves = ['L', 'L', 'L', 'W', 'W', 'W'];
  const pos = trajectory(lvl, moves);
  assert.equal(pos.length, 7);
  const g = newGame(lvl);
  moves.forEach((m) => applyMove(g, m));
  assert.deepEqual(g.ghosts[0], pos);
  assert.ok(scheduleOf(lvl, pos) > 0n, 'ghost holds the plate at some point');
});

test('game loop rollover, losing, undo across loops', () => {
  const lvl = parseLevel(TWO_LOOP, { T: 4, maxLoops: 2 });
  const g = newGame(lvl);
  endLoop(g);
  assert.equal(loopIndex(g), 1);
  assert.equal(timeOf(g), 0);
  endLoop(g);
  assert.ok(g.lost);
  undo(g);
  assert.ok(!g.lost);
  assert.equal(loopIndex(g), 1);
  assert.equal(timeOf(g), 3);
  undo(g); undo(g); undo(g); undo(g); // back across loop boundary
  assert.equal(loopIndex(g), 0);
  assert.equal(timeOf(g), 3);
  for (let i = 0; i < 10; i++) undo(g);
  assert.equal(timeOf(g), 0);
  assert.equal(loopIndex(g), 0);
});

test('moves after winning are ignored; undo un-wins', () => {
  const lvl = parseLevel(TWO_LOOP, { T: 6 });
  const g = play(lvl, solve(lvl).plan);
  const t = timeOf(g);
  applyMove(g, 'L');
  assert.equal(timeOf(g), t);
  undo(g);
  assert.ok(!g.won);
  assert.equal(totalMoves(newGame(lvl)), 0);
});

test('generator is deterministic', () => {
  const a = generateLevel(12345), b = generateLevel(12345);
  assert.deepEqual(a.level.rows, b.level.rows);
  assert.equal(a.level.T, b.level.T);
  assert.deepEqual(a.solution.plan, b.solution.plan);
});

test('100 generated puzzles: all solvable, all need >= 2 loops, solutions replay to a win', () => {
  const pars = { 2: 0, 3: 0 };
  for (let seed = 1; seed <= 100; seed++) {
    const { level, solution } = generateLevel(seed);
    assert.ok(level.par >= 2 && level.par <= level.maxLoops, `seed ${seed} par`);
    assert.equal(solveFinalLoop(level, 0n), null, `seed ${seed} must not be solvable in one loop`);
    const g = play(level, solution.plan);
    assert.ok(g.won, `seed ${seed} solution replays to a win`);
    assert.equal(loopIndex(g) + 1, level.par);
    pars[level.par]++;
  }
  assert.ok(pars[3] > 0, 'some puzzles need three loops');
});

test('fallback level is valid', () => {
  const lvl = parseLevel(FALLBACK_ROWS, { T: 12 });
  assert.equal(solve(lvl).loops, 2);
});

test('daily numbering and share text', () => {
  assert.equal(dayNumber(new Date(Date.UTC(2026, 0, 1, 23))), 1);
  assert.equal(dayNumber(new Date(Date.UTC(2026, 0, 2))), 2);
  assert.notEqual(seedForDay(1), seedForDay(2));
  assert.equal(shareText({ label: '#5', loopsUsed: 2, par: 2, moves: 9 }), 'Loopback #5\n👻🤖 2/2 loops ⭐\n9 moves');
  assert.ok(!shareText({ label: '#5', loopsUsed: 3, par: 2, moves: 9 }).includes('⭐'));
});
